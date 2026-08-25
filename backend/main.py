import os
os.environ["CUDA_VISIBLE_DEVICES"] = ""

# Monkeypatch torch.jit.load to force map_location="cpu" to prevent CUDA JIT loading errors on CPU-only setups
import torch
orig_jit_load = torch.jit.load
def patched_jit_load(f, map_location=None, *args, **kwargs):
    return orig_jit_load(f, map_location="cpu", *args, **kwargs)
torch.jit.load = patched_jit_load

import shutil
import uuid
import subprocess
import cv2
import numpy as np
import json
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw
import io

app = FastAPI(title="Watermark Remover API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_headers=["*"],
    allow_methods=["*"],
)

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# Global LaMa Model instance loaded lazily
_simple_lama = None

def get_lama_model():
    global _simple_lama
    if _simple_lama is None:
        print("Loading LaMa AI Inpainting Model...")
        from simple_lama_inpainting import SimpleLama
        _simple_lama = SimpleLama()
        print("LaMa AI Model loaded successfully!")
    return _simple_lama

def cleanup_file(path: str):
    """Utility to delete temporary files after request completes."""
    try:
        if os.path.exists(path):
            os.remove(path)
            print(f"Cleaned up temp file: {path}")
    except Exception as e:
        print(f"Error cleaning up file {path}: {e}")

def resolve_ffmpeg_path():
    """Dynamically locates ffmpeg.exe, supporting WinGet installs."""
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        import glob
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            winget_dir = os.path.join(local_appdata, "Microsoft", "WinGet", "Packages")
            if os.path.exists(winget_dir):
                matches = glob.glob(os.path.join(winget_dir, "**", "ffmpeg.exe"), recursive=True)
                if matches:
                    ffmpeg_bin = matches[0]
    return ffmpeg_bin or "ffmpeg"

MASKS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "masks")

def load_masks():
    masks = {}
    names = {
        "v1_large": ("bg_96.png", 96, 1.00),
        "v1_small": ("bg_48.png", 48, 0.79),
        "v2_large": ("bg_b_96.png", 96, 1.00),
        "v2_small": ("bg_b_36.png", 36, 0.79)
    }
    for key, (filename, canonical_scale, k) in names.items():
        path = os.path.join(MASKS_DIR, filename)
        if os.path.exists(path):
            img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
            if img is not None:
                masks[key] = {
                    "img": img,
                    "scale": canonical_scale,
                    "k": k
                }
    return masks

_masks = None
def get_masks():
    global _masks
    if _masks is None:
        _masks = load_masks()
    return _masks

def detect_watermark(gray_img, x_range, y_range):
    masks = get_masks()
    best_score = -1.0
    best_match = None
    
    gray_f = gray_img.astype(np.float32) / 255.0
    
    x1, y1 = max(0, x_range[0]), max(0, y_range[0])
    x2, y2 = min(gray_img.shape[1], x_range[1]), min(gray_img.shape[0], y_range[1])
    
    if x2 - x1 < 16 or y2 - y1 < 16:
        return None
        
    roi = gray_f[y1:y2, x1:x2]
    
    # Determine search region dimensions and if it's a local user-guided box search
    region_w = x2 - x1
    region_h = y2 - y1
    is_local_search = (region_w <= 400 and region_h <= 400)
    
    # Filter masks based on image size to prevent small templates matching noise on high-res images
    # Bypass this lock if it is a local user-guided search
    is_large_img = (gray_img.shape[0] >= 1000 and gray_img.shape[1] >= 1000)
    if is_large_img and not is_local_search:
        filtered_masks = {k: v for k, v in masks.items() if "large" in k}
    else:
        filtered_masks = masks.copy()
        
    if is_local_search:
        box_size = min(region_w, region_h)
        # Filter templates that are too small for the user's selection box to prevent false positives from noise
        filtered_masks = {k: v for k, v in filtered_masks.items() if v["scale"] >= 0.15 * box_size}
        
    for key, mask_info in filtered_masks.items():
        mask_img = mask_info["img"]
        canonical_scale = mask_info["scale"]
        
        if is_local_search:
            # Widen scale search range to check all sizes from 32 to 160
            if "small" in key:
                scale_min = 32
                scale_max = min(min(roi.shape[0], roi.shape[1]), 80)
            else:  # large
                scale_min = 60
                scale_max = min(min(roi.shape[0], roi.shape[1]), 160)
        else:
            scale_min = max(32, canonical_scale - 8)
            scale_max = min(min(roi.shape[0], roi.shape[1]), canonical_scale + 8)
            
        scale_min = max(32, scale_min)
        if scale_min > scale_max:
            continue
            
        for scale in range(scale_min, scale_max + 1, 2):
            resized = cv2.resize(mask_img, (scale, scale), 
                                 interpolation=cv2.INTER_AREA if scale < canonical_scale else cv2.INTER_LINEAR)
            t = resized.astype(np.float32) / 255.0
            
            res = cv2.matchTemplate(roi, t, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, loc = cv2.minMaxLoc(res)
            
            weight = np.cbrt(scale / 96.0)
            weight = min(weight, 1.0)
            adj_score = max_val * weight
            
            if adj_score > best_score:
                best_score = adj_score
                best_match = {
                    "key": key,
                    "scale": scale,
                    "loc": (x1 + loc[0], y1 + loc[1]),
                    "score": adj_score
                }
                
    threshold = 0.70
    
    if best_match and best_score >= threshold:
        key = best_match["key"]
        canonical_scale = masks[key]["scale"]
        detected_scale = best_match["scale"]
        if abs(detected_scale - canonical_scale) <= 4:
            orig_loc = best_match["loc"]
            new_x = int(round(orig_loc[0] + (detected_scale - canonical_scale) / 2.0))
            new_y = int(round(orig_loc[1] + (detected_scale - canonical_scale) / 2.0))
            new_x = max(0, min(gray_img.shape[1] - canonical_scale, new_x))
            new_y = max(0, min(gray_img.shape[0] - canonical_scale, new_y))
            
            print(f"Snapped scale from {detected_scale} to canonical {canonical_scale}. Adjusted location from {orig_loc} to ({new_x}, {new_y})")
            best_match["scale"] = canonical_scale
            best_match["loc"] = (new_x, new_y)
        return best_match
    return None

def apply_reverse_blend(roi_float, alpha_map, k, logo_val=255.0):
    restored = roi_float.copy()
    a_scaled = alpha_map * k
    alpha_threshold = 0.002
    max_alpha = 0.99
    
    for c in range(3):
        numerator = roi_float[..., c] - (a_scaled * logo_val)
        denominator = 1.0 - a_scaled
        denom_clamped = np.maximum(denominator, 1.0 - max_alpha)
        res_c = numerator / denom_clamped
        mask_apply = a_scaled >= alpha_threshold
        restored[..., c] = np.where(mask_apply, np.clip(res_c, 0.0, 255.0), roi_float[..., c])
        
    return restored

def estimate_k(img_bgr, match_info):
    key = match_info["key"]
    scale = match_info["scale"]
    x, y = match_info["loc"]
    masks = get_masks()
    mask_info = masks[key]
    mask_img = mask_info["img"]
    
    roi = img_bgr[y:y+scale, x:x+scale].astype(np.float32)
    alpha_map = mask_img.astype(np.float32) / 255.0
    alpha_map = cv2.resize(alpha_map, (scale, scale), 
                           interpolation=cv2.INTER_AREA if scale < mask_img.shape[0] else cv2.INTER_LINEAR)
    
    inpaint_mask = (alpha_map > 0.05).astype(np.uint8) * 255
    bg_est = cv2.inpaint(roi.astype(np.uint8), inpaint_mask, 3, cv2.INPAINT_TELEA).astype(np.float32)
    
    valid_pixels = alpha_map > 0.1
    if not np.any(valid_pixels):
        return mask_info["k"]
        
    y_val = roi[valid_pixels] - bg_est[valid_pixels]
    x_val = alpha_map[valid_pixels][..., None] * (255.0 - bg_est[valid_pixels])
    
    k = np.sum(x_val * y_val) / (np.sum(x_val * x_val) + 1e-6)
    return float(np.clip(k, 0.10, 1.20))

def remove_watermark_mathematically(img, match_info, k=None):
    key = match_info["key"]
    scale = match_info["scale"]
    x, y = match_info["loc"]
    
    masks = get_masks()
    mask_info = masks[key]
    mask_img = mask_info["img"]
    if k is None:
        k = estimate_k(img, match_info)
        print(f"Dynamic k estimated: {k:.4f}")
    
    roi = img[y:y+scale, x:x+scale]
    roi_float = roi.astype(np.float32)
    
    alpha_map = mask_img.astype(np.float32) / 255.0
    alpha_map = cv2.resize(alpha_map, (scale, scale), 
                           interpolation=cv2.INTER_AREA if scale < mask_img.shape[0] else cv2.INTER_LINEAR)
    
    restored_roi = apply_reverse_blend(roi_float, alpha_map, k=k)
    img_restored = img.copy()
    img_restored[y:y+scale, x:x+scale] = restored_roi.astype(np.uint8)
    
    return img_restored

@app.post("/api/remove-watermark/image")
async def remove_watermark_image(
    image: UploadFile = File(...),
    mask: UploadFile = File(...)
):
    try:
        # Load image bytes as PIL
        img_bytes = await image.read()
        img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_np = np.array(img_pil)
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

        # Load mask bytes as PIL
        mask_bytes = await mask.read()
        mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")
        mask_np = np.array(mask_pil)

        y_indices, x_indices = np.where(mask_np > 128)
        if len(y_indices) > 0:
            y1, y2 = y_indices.min(), y_indices.max()
            x1, x2 = x_indices.min(), x_indices.max()
            pad = 20
            y1_pad = max(0, y1 - pad)
            y2_pad = min(img_bgr.shape[0], y2 + pad)
            x1_pad = max(0, x1 - pad)
            x2_pad = min(img_bgr.shape[1], x2 + pad)
            
            gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            match = detect_watermark(gray, (x1_pad, x2_pad), (y1_pad, y2_pad))
            
            if match:
                print(f"Detected standard watermark: {match['key']} at scale {match['scale']} at {match['loc']} with score {match['score']:.4f}")
                img_cleaned_bgr = remove_watermark_mathematically(img_bgr, match)
                img_cleaned_rgb = cv2.cvtColor(img_cleaned_bgr, cv2.COLOR_BGR2RGB)
                result_pil = Image.fromarray(img_cleaned_rgb)
            else:
                print("No standard watermark detected in mask. Falling back to LaMa AI Inpainting.")
                lama = get_lama_model()
                result_pil = lama(img_pil, mask_pil)
        else:
            lama = get_lama_model()
            result_pil = lama(img_pil, mask_pil)

        output_buffer = io.BytesIO()
        result_pil.save(output_buffer, format="PNG")
        output_buffer.seek(0)
        
        return StreamingResponse(
            output_buffer,
            media_type="image/png",
            headers={"Content-Disposition": "attachment; filename=cleaned_image.png"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


@app.post("/api/remove-watermark/video")
def remove_watermark_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    x: int = Form(...),
    y: int = Form(...),
    w: int = Form(...),
    h: int = Form(...),
    boxes_json: Optional[str] = Form(None),
    mode: str = Form("fast")
):
    file_id = str(uuid.uuid4())
    input_ext = os.path.splitext(video.filename or "")[1] or ".mp4"
    
    temp_input_path = os.path.join(TEMP_DIR, f"input_{file_id}{input_ext}")
    temp_raw_processed_path = os.path.join(TEMP_DIR, f"raw_processed_{file_id}.mp4")
    temp_output_path = os.path.join(TEMP_DIR, f"output_{file_id}.mp4")

    try:
        # Save uploaded video
        with open(temp_input_path, "wb") as buffer:
            shutil.copyfileobj(video.file, buffer)

        # Open video with OpenCV
        cap = cv2.VideoCapture(temp_input_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Cannot open video file")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Parse multiple bounding boxes if provided in boxes_json
        boxes = []
        if boxes_json:
            try:
                parsed_boxes = json.loads(boxes_json)
                if isinstance(parsed_boxes, list) and len(parsed_boxes) > 0:
                    for b in parsed_boxes:
                        bx = max(0, min(int(b.get("x", 0)), width - 1))
                        by = max(0, min(int(b.get("y", 0)), height - 1))
                        bw = max(1, min(int(b.get("w", 10)), width - bx))
                        bh = max(1, min(int(b.get("h", 10)), height - by))
                        st = float(b.get("start_time", 0.0))
                        et = float(b.get("end_time", 99999.0))
                        boxes.append({
                            "x": bx, "y": by, "w": bw, "h": bh,
                            "start_time": st, "end_time": et
                        })
            except Exception as parse_err:
                print(f"Video: Error parsing boxes_json: {parse_err}")

        if not boxes:
            boxes = [{
                "x": max(0, min(x, width - 1)),
                "y": max(0, min(y, height - 1)),
                "w": max(1, min(w, width - x)),
                "h": max(1, min(h, height - y)),
                "start_time": 0.0,
                "end_time": 99999.0
            }]

        print(f"Video: Processing total {len(boxes)} box region(s) in '{mode}' mode...")

        # Sample frames to detect standard watermarks for each box
        sample_indices = []
        if total_frames > 0:
            num_samples = min(7, total_frames)
            sample_indices = [int(i * (total_frames - 1) / max(1, num_samples - 1)) for i in range(num_samples)]
        else:
            sample_indices = [0]

        box_configs = []
        for idx, b in enumerate(boxes):
            pad = 20
            bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
            x_range = (max(0, bx - pad), min(width, bx + bw + pad))
            y_range = (max(0, by - pad), min(height, by + bh + pad))

            best_match = None
            best_score = -1.0
            best_frame = None

            for f_idx in sample_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
                ret_sample, sample_frame = cap.read()
                if ret_sample:
                    gray_sample = cv2.cvtColor(sample_frame, cv2.COLOR_BGR2GRAY)
                    match = detect_watermark(gray_sample, x_range, y_range)
                    if match and match["score"] > best_score:
                        best_score = match["score"]
                        best_match = match
                        best_frame = sample_frame

            cfg = {
                "box": b,
                "match": best_match,
                "k_val": None,
                "crop_coords": None,
                "local_mask": None,
                "local_mask_pil": None
            }

            if best_match:
                key = best_match["key"]
                m_scale = best_match["scale"]
                m_x, m_y = best_match["loc"]
                print(f"Video Box #{idx + 1}: Detected standard watermark {key} at scale {m_scale} at ({m_x}, {m_y}) score {best_match['score']:.4f}")

                masks = get_masks()
                mask_info = masks[key]
                mask_img = mask_info["img"]

                k_val = estimate_k(best_frame, best_match)
                cfg["k_val"] = k_val

                box_pad = 10
                m_x_pad = m_x - box_pad
                m_y_pad = m_y - box_pad
                m_scale_pad = m_scale + 2 * box_pad

                alpha_map = cv2.resize(mask_img, (m_scale, m_scale),
                                       interpolation=cv2.INTER_AREA if m_scale < mask_img.shape[0] else cv2.INTER_LINEAR)
                alpha_bin = (alpha_map > 20).astype(np.uint8) * 255

                watermark_mask = np.zeros((m_scale_pad, m_scale_pad), dtype=np.uint8)
                watermark_mask[box_pad:box_pad+m_scale, box_pad:box_pad+m_scale] = alpha_bin

                k_size = 8
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
                inpaint_mask = cv2.dilate(watermark_mask, kernel)

                pad_ip = 40
                py1 = max(0, m_y_pad - pad_ip)
                py2 = min(height, m_y_pad + m_scale_pad + pad_ip)
                px1 = max(0, m_x_pad - pad_ip)
                px2 = min(width, m_x_pad + m_scale_pad + pad_ip)
                oy = m_y_pad - py1
                ox = m_x_pad - px1

                padded_mask = np.zeros((py2 - py1, px2 - px1), dtype=np.uint8)
                padded_mask[oy:oy+m_scale_pad, ox:ox+m_scale_pad] = inpaint_mask

                cfg["crop_coords"] = (py1, py2, px1, px2)
                cfg["local_mask"] = padded_mask
                cfg["local_mask_pil"] = Image.fromarray(padded_mask)
            else:
                print(f"Video Box #{idx + 1}: Generic rectangle ({bx}, {by}, {bw}, {bh})")
                padding = 20
                crop_x = max(0, bx - padding)
                crop_y = max(0, by - padding)
                crop_x2 = min(width, bx + bw + padding)
                crop_y2 = min(height, by + bh + padding)
                crop_w = crop_x2 - crop_x
                crop_h = crop_y2 - crop_y
                rel_x = bx - crop_x
                rel_y = by - crop_y

                local_mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
                cv2.rectangle(local_mask, (rel_x, rel_y), (rel_x + bw, rel_y + bh), 255, -1)

                cfg["crop_coords"] = (crop_y, crop_y2, crop_x, crop_x2)
                cfg["local_mask"] = local_mask
                cfg["local_mask_pil"] = Image.fromarray(local_mask)

            box_configs.append(cfg)

        # Prepare VideoWriter
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(temp_raw_processed_path, fourcc, fps, (width, height))

        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        frame_idx = 0
        lama = None
        if mode == "ai":
            lama = get_lama_model()

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            t = frame_idx / fps
            frame_idx += 1

            for cfg in box_configs:
                b = cfg["box"]
                st = b["start_time"]
                et = b["end_time"]

                if t < st or t > et:
                    continue

                match_info = cfg["match"]
                py1, py2, px1, px2 = cfg["crop_coords"]

                if py2 <= py1 or px2 <= px1:
                    continue

                if match_info and mode == "fast":
                    frame = remove_watermark_mathematically(frame, match_info, k=cfg["k_val"])
                elif mode == "ai":
                    local_mask_pil = cfg["local_mask_pil"]
                    frame_crop = frame[py1:py2, px1:px2]
                    crop_h_actual, crop_w_actual = frame_crop.shape[:2]

                    if local_mask_pil.size != (crop_w_actual, crop_h_actual):
                        mask_np_trimmed = cfg["local_mask"][0:crop_h_actual, 0:crop_w_actual]
                        mask_to_use = Image.fromarray(mask_np_trimmed)
                    else:
                        mask_to_use = local_mask_pil

                    crop_rgb = cv2.cvtColor(frame_crop, cv2.COLOR_BGR2RGB)
                    crop_pil = Image.fromarray(crop_rgb)

                    inpainted_crop_pil = lama(crop_pil, mask_to_use)
                    inpainted_crop_pil = inpainted_crop_pil.crop((0, 0, crop_w_actual, crop_h_actual))

                    inpainted_crop_np = np.array(inpainted_crop_pil)
                    inpainted_crop_bgr = cv2.cvtColor(inpainted_crop_np, cv2.COLOR_RGB2BGR)
                    frame[py1:py2, px1:px2] = inpainted_crop_bgr
                else:
                    local_mask = cfg["local_mask"]
                    frame_crop = frame[py1:py2, px1:px2]
                    crop_h_actual, crop_w_actual = frame_crop.shape[:2]
                    mask_trimmed = local_mask[0:crop_h_actual, 0:crop_w_actual]

                    inpainted_crop_bgr = cv2.inpaint(frame_crop, mask_trimmed, 3, cv2.INPAINT_TELEA)
                    frame[py1:py2, px1:px2] = inpainted_crop_bgr

            out.write(frame)

        cap.release()
        out.release()
        
        ffmpeg_bin = resolve_ffmpeg_path()
        cmd = [
            ffmpeg_bin, "-y",
            "-i", temp_input_path,
            "-i", temp_raw_processed_path,
            "-map", "1:v",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-crf", "18",
            "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            temp_output_path
        ]
        
        process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if process.returncode != 0:
            print("FFmpeg encoding error:", process.stderr)
            raise Exception("FFmpeg audio mapping and encoding failed")
            
        background_tasks.add_task(cleanup_file, temp_input_path)
        background_tasks.add_task(cleanup_file, temp_raw_processed_path)
        background_tasks.add_task(cleanup_file, temp_output_path)
        
        return FileResponse(
            temp_output_path,
            media_type="video/mp4",
            filename="cleaned_video.mp4"
        )
    except Exception as e:
        cleanup_file(temp_input_path)
        cleanup_file(temp_raw_processed_path)
        cleanup_file(temp_output_path)
        raise HTTPException(status_code=500, detail=f"Error processing video: {str(e)}")

examples_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Examples")
if os.path.exists(examples_dir):
    app.mount("/Examples", StaticFiles(directory=examples_dir), name="examples")

# Mount static frontend files
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    print(f"Warning: Frontend directory {frontend_dir} does not exist yet.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
