// State variables
let activeTab = 'image';
let selectedImageFile = null;
let selectedVideoFile = null;

// Image Editor state
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
let maskCanvas = document.createElement('canvas');
let maskCtx = maskCanvas.getContext('2d');
let isDrawing = false;
let brushSize = 15;
let originalImage = new Image();

// Zoom and tool state for image
let imageZoomLevel = 1.0;
let imageTool = 'brush'; // 'brush' | 'rect' | 'pan'
let imageMaskHistory = []; // Undo stack of { visibleData, maskData }
let isSelectingImage = false;
let imgStartX = 0;
let imgStartY = 0;
let imageCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };

const imageScrollContainer = document.getElementById('image-scroll-container');
const imageZoomWrapper = document.getElementById('image-zoom-wrapper');
const imageSelectionOverlay = document.getElementById('image-selection-overlay');

// Video Editor state
const videoPlayer = document.getElementById('editor-video');
const selectionOverlay = document.getElementById('video-selection-overlay');
let isSelectingVideo = false;
let startX, startY;
let currentCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };

// Zoom and tool state for video
let videoZoomLevel = 1.0;
let videoTool = 'rect'; // 'rect' | 'pan'
let videoDisplayWidth = 0;
let videoDisplayHeight = 0;

const videoScrollContainer = document.getElementById('video-scroll-container');
const videoZoomWrapper = document.getElementById('video-zoom-wrapper');
let videoMode = 'fast'; // 'fast' (OpenCV) | 'ai' (LaMa)

// Grab-to-pan state variables
let isPanningImage = false;
let isPanningVideo = false;
let panStartX = 0;
let panStartY = 0;
let scrollLeftStart = 0;
let scrollTopStart = 0;

// Toast Notification Helper
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const iconName = type === 'success' ? 'check-circle-2' : 'alert-circle';
    
    toast.innerHTML = `<i data-lucide="${iconName}" class="toast-icon"></i> <span>${message}</span>`;
    
    // Dynamic Lucide creation for the toast icon
    lucide.createIcons({
        attrs: { class: 'toast-icon' },
        nameAttr: 'data-lucide',
        nodeList: toast.querySelectorAll('.toast-icon')
    });
    
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3500);
}

// Loader Helpers
function showLoader(text) {
    document.getElementById('loader-text').textContent = text;
    document.getElementById('loader').style.display = 'flex';
}

// Update Loader Subtext
function updateLoaderSubtext(subtext) {
    const sub = document.querySelector('.loader-subtext');
    if (sub) sub.textContent = subtext;
}

// Hide Loader
function hideLoader() {
    document.getElementById('loader').style.display = 'none';
}

// Tab Switching with sliding background transition
function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    
    const slider = document.getElementById('tab-indicator');
    const activeBtn = tab === 'image' ? document.getElementById('tab-image-btn') : document.getElementById('tab-video-btn');
    
    activeBtn.classList.add('active');
    if (tab === 'image') {
        document.getElementById('image-panel').classList.add('active');
        slider.style.transform = 'translateX(0)';
        slider.style.width = activeBtn.offsetWidth + 'px';
    } else {
        document.getElementById('video-panel').classList.add('active');
        const imageBtn = document.getElementById('tab-image-btn');
        slider.style.transform = `translateX(${imageBtn.offsetWidth + 4}px)`;
        slider.style.width = activeBtn.offsetWidth + 'px';
    }
}

// ==========================================
// IMAGE TAB LOGIC
// ==========================================

const imageDropzone = document.getElementById('image-dropzone');
const imageInput = document.getElementById('image-input');

// Drag and drop setup for image
['dragenter', 'dragover'].forEach(eventName => {
    imageDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        imageDropzone.style.borderColor = 'var(--accent)';
        imageDropzone.style.background = 'rgba(6, 182, 212, 0.03)';
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    imageDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        imageDropzone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        imageDropzone.style.background = 'rgba(255, 255, 255, 0.005)';
    }, false);
});

imageDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
        loadImage(files[0]);
    } else {
        showToast('请上传有效的图片文件', 'error');
    }
});

imageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadImage(e.target.files[0]);
    }
});

// Load Image into Editor Canvas
function loadImage(file) {
    selectedImageFile = file;
    imageMaskHistory = [];
    imageCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
    document.getElementById('image-undo-btn').disabled = true;
    imageSelectionOverlay.style.display = 'none';
    
    // Hide results if they were visible from previous runs
    document.getElementById('image-result-container').style.display = 'none';
    
    showLoader('正在加载图片...');
    updateLoaderSubtext('请稍候');
    
    const reader = new FileReader();
    reader.onload = (event) => {
        originalImage.onload = () => {
            setupCanvases();
            setImageTool('brush');
            document.getElementById('image-dropzone').style.display = 'none';
            document.getElementById('image-editor').style.display = 'block';
            hideLoader();
            showToast('图片加载成功！请使用画笔涂抹水印区域。', 'success');
            lucide.createIcons(); // Instantiates newly added icons
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function setupCanvases() {
    const pad = 24;
    const availableW = Math.max(200, (imageScrollContainer.clientWidth || 650) - pad);
    const availableH = Math.max(200, (imageScrollContainer.clientHeight || 500) - pad);
    
    let width = originalImage.width;
    let height = originalImage.height;
    
    let scale = Math.min(availableW / width, availableH / height);
    if (!isFinite(scale) || scale <= 0) scale = 1.0;
    
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    
    canvas.width = width;
    canvas.height = height;
    
    // Set zoom wrapper size
    imageZoomWrapper.style.width = width + 'px';
    imageZoomWrapper.style.height = height + 'px';
    imageScrollContainer.style.height = '';
    
    // Setup hidden original-resolution mask canvas
    maskCanvas.width = originalImage.width;
    maskCanvas.height = originalImage.height;
    
    // Clear canvases
    ctx.clearRect(0, 0, width, height);
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    
    // Draw original image onto visible canvas
    ctx.drawImage(originalImage, 0, 0, width, height);
    
    applyImageZoom(1.0);
}

// Drawing/Selecting logic on image canvas
function updateBrushSize(val) {
    brushSize = parseInt(val);
    document.getElementById('brush-size-val').textContent = val + 'px';
}

// Image tool configuration
function setImageTool(tool) {
    imageTool = tool;
    document.getElementById('tool-brush-btn').classList.remove('active');
    document.getElementById('tool-rect-btn').classList.remove('active');
    document.getElementById('tool-pan-btn').classList.remove('active');
    
    if (tool === 'brush') {
        document.getElementById('tool-brush-btn').classList.add('active');
        document.getElementById('brush-size-control-group').style.display = 'flex';
        imageSelectionOverlay.style.display = 'none';
        canvas.style.cursor = 'crosshair';
    } else if (tool === 'rect') {
        document.getElementById('tool-rect-btn').classList.add('active');
        document.getElementById('brush-size-control-group').style.display = 'none';
        canvas.style.cursor = 'crosshair';
        if (imageCoords.rw > 0 && imageCoords.rh > 0) {
            imageSelectionOverlay.style.display = 'block';
        } else {
            imageSelectionOverlay.style.display = 'none';
        }
    } else if (tool === 'pan') {
        document.getElementById('tool-pan-btn').classList.add('active');
        document.getElementById('brush-size-control-group').style.display = 'none';
        imageSelectionOverlay.style.display = 'none';
        canvas.style.cursor = 'grab';
    }
}

// Image Zoom functionality
function zoomImage(factor) {
    let newZoom = imageZoomLevel * factor;
    newZoom = Math.max(0.5, Math.min(newZoom, 4.0));
    applyImageZoom(newZoom);
}

function resetZoomImage() {
    applyImageZoom(1.0);
}

function applyImageZoom(level) {
    imageZoomLevel = level;
    document.getElementById('image-zoom-val').textContent = Math.round(imageZoomLevel * 100) + '%';
    
    imageZoomWrapper.style.transform = `scale(${imageZoomLevel})`;
    
    if (imageZoomLevel >= 1.0) {
        imageScrollContainer.style.overflow = 'auto';
    } else {
        imageScrollContainer.style.overflow = 'hidden';
    }
    
    const scrollArea = document.getElementById('image-scroll-area');
    if (canvas.width) {
        scrollArea.style.width = (canvas.width * imageZoomLevel) + 'px';
        scrollArea.style.height = (canvas.height * imageZoomLevel) + 'px';
    }
}

// Undo Stack functions
function saveImageMaskState() {
    const state = {
        visibleData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        maskData: maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    };
    imageMaskHistory.push(state);
    if (imageMaskHistory.length > 20) {
        imageMaskHistory.shift();
    }
    document.getElementById('image-undo-btn').disabled = false;
}

function undoImageStroke() {
    if (imageMaskHistory.length > 0) {
        const state = imageMaskHistory.pop();
        ctx.putImageData(state.visibleData, 0, 0);
        maskCtx.putImageData(state.maskData, 0, 0);
        if (imageMaskHistory.length === 0) {
            document.getElementById('image-undo-btn').disabled = true;
        }
        showToast('已撤销上一步操作', 'success');
    }
}

// Navigation back to upload
function goBackToUpload() {
    selectedImageFile = null;
    imageMaskHistory = [];
    imageCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
    imageScrollContainer.style.height = '';
    document.getElementById('image-editor').style.display = 'none';
    document.getElementById('image-dropzone').style.display = 'block';
    document.getElementById('image-input').value = '';
    document.getElementById('image-undo-btn').disabled = true;
    imageSelectionOverlay.style.display = 'none';
}

// Event handlers for Image mouse operations
canvas.addEventListener('mousedown', (e) => {
    if (imageTool === 'brush') {
        startDrawing(e);
    } else if (imageTool === 'rect') {
        startImageSelection(e);
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (imageTool === 'brush') {
        draw(e);
    }
});

canvas.addEventListener('mouseup', () => {
    if (imageTool === 'brush') stopDrawing();
});

canvas.addEventListener('mouseleave', () => {
    if (imageTool === 'brush') stopDrawing();
});

// Touch listeners for Image
canvas.addEventListener('touchstart', (e) => {
    if (imageTool === 'brush') {
        e.preventDefault();
        if (e.touches.length > 0) startDrawing(e.touches[0]);
    } else if (imageTool === 'rect') {
        if (e.touches.length > 0) startImageSelection(e.touches[0]);
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (imageTool === 'brush') {
        e.preventDefault();
        if (e.touches.length > 0) draw(e.touches[0]);
    } else if (isSelectingImage) {
        if (e.touches.length > 0) drawImageSelection(e.touches[0]);
    }
});

canvas.addEventListener('touchend', () => {
    if (imageTool === 'brush') {
        stopDrawing();
    } else if (isSelectingImage) {
        stopImageSelection();
    }
});

// Panning for Image scroll container
imageScrollContainer.addEventListener('mousedown', (e) => {
    if (imageTool === 'pan') {
        isPanningImage = true;
        imageScrollContainer.style.cursor = 'grabbing';
        panStartX = e.clientX;
        panStartY = e.clientY;
        scrollLeftStart = imageScrollContainer.scrollLeft;
        scrollTopStart = imageScrollContainer.scrollTop;
        e.preventDefault();
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanningImage && imageTool === 'pan') {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        imageScrollContainer.scrollLeft = scrollLeftStart - dx;
        imageScrollContainer.scrollTop = scrollTopStart - dy;
    } else if (isSelectingImage && imageTool === 'rect') {
        drawImageSelection(e);
    }
});

window.addEventListener('mouseup', () => {
    if (isPanningImage) {
        isPanningImage = false;
        imageScrollContainer.style.cursor = 'grab';
    }
    if (isSelectingImage) {
        stopImageSelection();
    }
});

// Touch support for image panning
imageScrollContainer.addEventListener('touchstart', (e) => {
    if (imageTool === 'pan' && e.touches.length > 0) {
        isPanningImage = true;
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        scrollLeftStart = imageScrollContainer.scrollLeft;
        scrollTopStart = imageScrollContainer.scrollTop;
    }
}, { passive: true });

imageScrollContainer.addEventListener('touchmove', (e) => {
    if (isPanningImage && imageTool === 'pan' && e.touches.length > 0) {
        const dx = e.touches[0].clientX - panStartX;
        const dy = e.touches[0].clientY - panStartY;
        imageScrollContainer.scrollLeft = scrollLeftStart - dx;
        imageScrollContainer.scrollTop = scrollTopStart - dy;
    }
}, { passive: true });

imageScrollContainer.addEventListener('touchend', () => {
    isPanningImage = false;
});

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    saveImageMaskState();
    isDrawing = true;
    const pos = getMousePos(e);
    
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    
    const scale = originalImage.width / canvas.width;
    maskCtx.beginPath();
    maskCtx.moveTo(pos.x * scale, pos.y * scale);
}

// Brush draw function
function draw(e) {
    if (!isDrawing) return;
    const pos = getMousePos(e);
    
    // Draw visual red stroke on visible canvas
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    // Draw white stroke on high-res mask canvas
    const scale = originalImage.width / canvas.width;
    maskCtx.strokeStyle = 'white';
    maskCtx.lineWidth = brushSize * scale;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.lineTo(pos.x * scale, pos.y * scale);
    maskCtx.stroke();
}

function stopDrawing() {
    isDrawing = false;
}

// Rectangle selection for Image
function startImageSelection(e) {
    const rect = imageZoomWrapper.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    imgStartX = (clientX - rect.left) / imageZoomLevel;
    imgStartY = (clientY - rect.top) / imageZoomLevel;
    
    isSelectingImage = true;
    
    imageSelectionOverlay.style.left = imgStartX + 'px';
    imageSelectionOverlay.style.top = imgStartY + 'px';
    imageSelectionOverlay.style.width = '0px';
    imageSelectionOverlay.style.height = '0px';
    imageSelectionOverlay.style.display = 'block';
    
    if (e.cancelable) e.preventDefault();
}

function drawImageSelection(e) {
    if (!isSelectingImage) return;
    const rect = imageZoomWrapper.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    let currentX = (clientX - rect.left) / imageZoomLevel;
    let currentY = (clientY - rect.top) / imageZoomLevel;
    
    currentX = Math.max(0, Math.min(currentX, canvas.width));
    currentY = Math.max(0, Math.min(currentY, canvas.height));
    
    const x = Math.min(imgStartX, currentX);
    const y = Math.min(imgStartY, currentY);
    const w = Math.abs(imgStartX - currentX);
    const h = Math.abs(imgStartY - currentY);
    
    imageSelectionOverlay.style.left = x + 'px';
    imageSelectionOverlay.style.top = y + 'px';
    imageSelectionOverlay.style.width = w + 'px';
    imageSelectionOverlay.style.height = h + 'px';
    
    imageCoords = {
        rx: x / canvas.width,
        ry: y / canvas.height,
        rw: w / canvas.width,
        rh: h / canvas.height
    };
}

function stopImageSelection() {
    if (isSelectingImage) {
        isSelectingImage = false;
        if (imageTool === 'rect' && imageCoords.rw > 0.005 && imageCoords.rh > 0.005) {
            saveImageMaskState();
            
            const realX = imageCoords.rx * originalImage.width;
            const realY = imageCoords.ry * originalImage.height;
            const realW = imageCoords.rw * originalImage.width;
            const realH = imageCoords.rh * originalImage.height;
            
            maskCtx.fillStyle = 'white';
            maskCtx.fillRect(realX, realY, realW, realH);
            
            const scale = canvas.width / originalImage.width;
            ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
            ctx.fillRect(imageCoords.rx * canvas.width, imageCoords.ry * canvas.height, imageCoords.rw * canvas.width, imageCoords.rh * canvas.height);
            
            imageCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
            imageSelectionOverlay.style.display = 'none';
            showToast('已添加框选区域！支持叠加多处框选。', 'success');
        }
    }
}

function clearImageMask() {
    saveImageMaskState();
    setupCanvases();
    imageCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
    imageSelectionOverlay.style.display = 'none';
    showToast('遮罩已清除', 'success');
}

// Preset Gemini Watermark (Image)
document.getElementById('gemini-img-preset-btn').addEventListener('click', () => {
    if (!originalImage.src) return;
    
    setupCanvases(); // clear current mask
    
    const w = originalImage.width;
    const h = originalImage.height;
    
    const boxW = Math.min(w, 256);
    const boxH = Math.min(h, 256);
    const boxX = w - boxW - Math.min(w * 0.03, 60);
    const boxY = h - boxH - Math.min(h * 0.03, 60);
    
    if (imageTool === 'rect') {
        imageCoords = {
            rx: boxX / w,
            ry: boxY / h,
            rw: boxW / w,
            rh: boxH / h
        };
        
        imageSelectionOverlay.style.left = (imageCoords.rx * canvas.width) + 'px';
        imageSelectionOverlay.style.top = (imageCoords.ry * canvas.height) + 'px';
        imageSelectionOverlay.style.width = (imageCoords.rw * canvas.width) + 'px';
        imageSelectionOverlay.style.height = (imageCoords.rh * canvas.height) + 'px';
        imageSelectionOverlay.style.display = 'block';
    } else {
        saveImageMaskState();
        // Draw on hidden mask
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(boxX, boxY, boxW, boxH);
        
        // Draw visual red overlay on screen canvas
        const scale = canvas.width / w;
        ctx.fillStyle = 'rgba(244, 63, 94, 0.5)';
        ctx.fillRect(boxX * scale, boxY * scale, boxW * scale, boxH * scale);
    }
    
    showToast('已应用 Gemini 预设！已选定右下角水印区域。', 'success');
});

// Process Image
function processImage() {
    if (!selectedImageFile) return;
    
    // Check if mask is empty
    let hasMask = false;
    const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0) { // white pixels on maskCanvas have red/green/blue channels > 0
            hasMask = true;
            break;
        }
    }
    
    if (!hasMask && imageCoords.rw > 0 && imageCoords.rh > 0) {
        hasMask = true;
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(
            imageCoords.rx * originalImage.width,
            imageCoords.ry * originalImage.height,
            imageCoords.rw * originalImage.width,
            imageCoords.rh * originalImage.height
        );
    }
    
    if (!hasMask) {
        showToast('请先选择或涂抹需要消除的水印区域。', 'error');
        return;
    }
    
    showLoader('AI 正在消除水印...');
    updateLoaderSubtext('正在应用数学减法算法');
    
    // Fill rectangle in mask if active tool is rect
    if (imageTool === 'rect' && imageCoords.rw > 0 && imageCoords.rh > 0) {
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        
        const realX = imageCoords.rx * originalImage.width;
        const realY = imageCoords.ry * originalImage.height;
        const realW = imageCoords.rw * originalImage.width;
        const realH = imageCoords.rh * originalImage.height;
        
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(realX, realY, realW, realH);
    }
    
    // Convert mask canvas to blob
    maskCanvas.toBlob((maskBlob) => {
        const formData = new FormData();
        formData.append('image', selectedImageFile);
        formData.append('mask', maskBlob, 'mask.png');
        
        fetch('/api/remove-watermark/image', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) throw new Error('服务器处理出错');
            return response.blob();
        })
        .then(cleanedBlob => {
            const cleanedUrl = URL.createObjectURL(cleanedBlob);
            
            // Set image sources
            document.getElementById('image-result-before').src = URL.createObjectURL(selectedImageFile);
            const afterImg = document.getElementById('image-result-after');
            afterImg.src = cleanedUrl;
            
            // Setup download link
            const downloadBtn = document.getElementById('download-image-btn');
            downloadBtn.href = cleanedUrl;
            
            // Show result section, hide editor
            document.getElementById('image-editor').style.display = 'none';
            document.getElementById('image-result-container').style.display = 'block';
            
            // Setup split slider
            initSlider();
            hideLoader();
            showToast('水印消除成功！', 'success');
            lucide.createIcons();
        })
        .catch(err => {
            hideLoader();
            showToast(err.message, 'error');
        });
    }, 'image/png');
}

function resetImageEditor() {
    document.getElementById('image-result-container').style.display = 'none';
    document.getElementById('image-editor').style.display = 'block';
    setupCanvases();
    lucide.createIcons();
}

// Split Comparison Slider Logic
function initSlider() {
    const container = document.querySelector('.comparison-container');
    const divider = document.getElementById('image-slider-divider');
    const afterWrapper = document.getElementById('image-result-after-wrapper');
    const sliderBtn = divider.querySelector('.slider-button');
    let isDraggingSlider = false;

    // Reset default slider positions to 50%
    afterWrapper.style.width = '50%';
    divider.style.left = '50%';
    sliderBtn.style.left = '50%';

    function move(x) {
        const rect = container.getBoundingClientRect();
        let pos = (x - rect.left) / rect.width;
        if (pos < 0) pos = 0;
        if (pos > 1) pos = 1;
        afterWrapper.style.width = (pos * 100) + '%';
        divider.style.left = (pos * 100) + '%';
        sliderBtn.style.left = (pos * 100) + '%';
    }

    // Mouse events
    divider.addEventListener('mousedown', (e) => {
        isDraggingSlider = true;
        e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
        isDraggingSlider = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingSlider) return;
        move(e.clientX);
    });

    // Touch events for mobile
    divider.addEventListener('touchstart', (e) => {
        isDraggingSlider = true;
    });

    window.addEventListener('touchend', () => {
        isDraggingSlider = false;
    });

    window.addEventListener('touchmove', (e) => {
        if (!isDraggingSlider) return;
        if (e.touches.length > 0) {
            move(e.touches[0].clientX);
        }
    });
}


// ==========================================
// VIDEO TAB LOGIC
// ==========================================

const videoDropzone = document.getElementById('video-dropzone');
const videoInput = document.getElementById('video-input');

// Drag and drop setup for video
['dragenter', 'dragover'].forEach(eventName => {
    videoDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        videoDropzone.style.borderColor = 'var(--accent)';
        videoDropzone.style.background = 'rgba(6, 182, 212, 0.03)';
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    videoDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        videoDropzone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        videoDropzone.style.background = 'rgba(255, 255, 255, 0.005)';
    }, false);
});

videoDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0 && files[0].type.startsWith('video/')) {
        loadVideo(files[0]);
    } else {
        showToast('请上传有效的视频文件', 'error');
    }
});

videoInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadVideo(e.target.files[0]);
    }
});

function loadVideo(file) {
    selectedVideoFile = file;
    
    // Hide results if they were visible from previous runs
    document.getElementById('video-result-container').style.display = 'none';
    
    showLoader('正在加载视频...');
    updateLoaderSubtext('请稍候');
    
    const videoUrl = URL.createObjectURL(file);
    videoPlayer.src = videoUrl;
    
    videoPlayer.onloadedmetadata = () => {
        const pad = 24;
        const availableW = Math.max(200, (videoScrollContainer.clientWidth || 600) - pad);
        const availableH = Math.max(200, (videoScrollContainer.clientHeight || 480) - pad);
        
        let width = videoPlayer.videoWidth;
        let height = videoPlayer.videoHeight;
        
        let scale = Math.min(availableW / width, availableH / height);
        if (!isFinite(scale) || scale <= 0) scale = 1.0;
        
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        
        videoPlayer.style.width = width + 'px';
        videoPlayer.style.height = height + 'px';
        videoDisplayWidth = width;
        videoDisplayHeight = height;
        
        videoZoomWrapper.style.width = width + 'px';
        videoZoomWrapper.style.height = height + 'px';
        videoScrollContainer.style.height = '';
        
        document.getElementById('video-dropzone').style.display = 'none';
        document.getElementById('video-editor').style.display = 'block';
        clearVideoSelection();
        setVideoTool('rect');
        applyVideoZoom(1.0);
        hideLoader();
        showToast('视频加载成功！请框选水印或标识区域。', 'success');
        lucide.createIcons();
    };
}

// Video tool configurations
function setVideoTool(tool) {
    videoTool = tool;
    document.getElementById('video-tool-rect-btn').classList.remove('active');
    document.getElementById('video-tool-pan-btn').classList.remove('active');
    
    if (tool === 'rect') {
        document.getElementById('video-tool-rect-btn').classList.add('active');
        videoScrollContainer.style.cursor = 'default';
        if (currentCoords.rw > 0 && currentCoords.rh > 0) {
            selectionOverlay.style.display = 'block';
        }
    } else if (tool === 'pan') {
        document.getElementById('video-tool-pan-btn').classList.add('active');
        videoScrollContainer.style.cursor = 'grab';
        selectionOverlay.style.display = 'none';
    }
}

// Video Zoom functionality
function zoomVideo(factor) {
    let newZoom = videoZoomLevel * factor;
    newZoom = Math.max(0.5, Math.min(newZoom, 4.0));
    applyVideoZoom(newZoom);
}

function resetZoomVideo() {
    applyVideoZoom(1.0);
}

function applyVideoZoom(level) {
    videoZoomLevel = level;
    document.getElementById('video-zoom-val').textContent = Math.round(videoZoomLevel * 100) + '%';
    
    videoZoomWrapper.style.transform = `scale(${videoZoomLevel})`;
    
    if (videoZoomLevel >= 1.0) {
        videoScrollContainer.style.overflow = 'auto';
    } else {
        videoScrollContainer.style.overflow = 'hidden';
    }
    
    const scrollArea = document.getElementById('video-scroll-area');
    if (videoDisplayWidth) {
        scrollArea.style.width = (videoDisplayWidth * videoZoomLevel) + 'px';
        scrollArea.style.height = (videoDisplayHeight * videoZoomLevel) + 'px';
    }
}

// Navigation back to video upload
function goBackToVideoUpload() {
    selectedVideoFile = null;
    videoPlayer.src = '';
    currentCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
    videoMode = 'fast';
    videoScrollContainer.style.height = '';
    document.getElementById('video-mode-fast-btn').classList.add('active');
    document.getElementById('video-mode-ai-btn').classList.remove('active');
    document.getElementById('video-editor').style.display = 'none';
    document.getElementById('video-dropzone').style.display = 'block';
    document.getElementById('video-input').value = '';
    selectionOverlay.style.display = 'none';
}

let activeBoxIndex = -1;
let boxDragMode = null; // 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'create'
let dragStartMouseX = 0;
let dragStartMouseY = 0;
let dragStartBox = null;

// Bounding box selection, dragging, and resizing logic on video player
videoZoomWrapper.addEventListener('mousedown', startVideoSelection);

function startVideoSelection(e) {
    if (videoTool !== 'rect') return;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    // Check if user clicked on an existing box handle or body
    const handleEl = e.target.closest('.selection-corner');
    const overlayEl = e.target.closest('#video-overlays-container .selection-overlay');
    
    if (handleEl && overlayEl) {
        // RESIZE MODE
        activeBoxIndex = parseInt(overlayEl.dataset.boxIndex);
        if (handleEl.classList.contains('top-left')) boxDragMode = 'resize-tl';
        else if (handleEl.classList.contains('top-right')) boxDragMode = 'resize-tr';
        else if (handleEl.classList.contains('bottom-left')) boxDragMode = 'resize-bl';
        else if (handleEl.classList.contains('bottom-right')) boxDragMode = 'resize-br';
        
        dragStartMouseX = clientX;
        dragStartMouseY = clientY;
        dragStartBox = { ...videoBoxes[activeBoxIndex] };
        renderVideoOverlays();
        renderVideoTracks();
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    if (overlayEl) {
        // MOVE MODE
        activeBoxIndex = parseInt(overlayEl.dataset.boxIndex);
        boxDragMode = 'move';
        dragStartMouseX = clientX;
        dragStartMouseY = clientY;
        dragStartBox = { ...videoBoxes[activeBoxIndex] };
        renderVideoOverlays();
        renderVideoTracks();
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    // CREATE NEW BOX MODE
    activeBoxIndex = -1;
    boxDragMode = 'create';
    
    const rect = videoZoomWrapper.getBoundingClientRect();
    startX = (clientX - rect.left) / videoZoomLevel;
    startY = (clientY - rect.top) / videoZoomLevel;

    isSelectingVideo = true;
    
    selectionOverlay.style.left = startX + 'px';
    selectionOverlay.style.top = startY + 'px';
    selectionOverlay.style.width = '0px';
    selectionOverlay.style.height = '0px';
    selectionOverlay.style.display = 'block';
    
    e.preventDefault();
}

function drawVideoSelection(e) {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    if (boxDragMode === 'move' && activeBoxIndex >= 0 && dragStartBox) {
        const deltaX = (clientX - dragStartMouseX) / (videoDisplayWidth * videoZoomLevel);
        const deltaY = (clientY - dragStartMouseY) / (videoDisplayHeight * videoZoomLevel);
        
        let newRx = dragStartBox.rx + deltaX;
        let newRy = dragStartBox.ry + deltaY;
        
        newRx = Math.max(0, Math.min(1 - dragStartBox.rw, newRx));
        newRy = Math.max(0, Math.min(1 - dragStartBox.rh, newRy));
        
        videoBoxes[activeBoxIndex].rx = newRx;
        videoBoxes[activeBoxIndex].ry = newRy;
        
        renderVideoOverlays();
        renderVideoTracks();
        return;
    }
    
    if (boxDragMode && boxDragMode.startsWith('resize-') && activeBoxIndex >= 0 && dragStartBox) {
        const deltaX = (clientX - dragStartMouseX) / (videoDisplayWidth * videoZoomLevel);
        const deltaY = (clientY - dragStartMouseY) / (videoDisplayHeight * videoZoomLevel);
        
        let rx = dragStartBox.rx;
        let ry = dragStartBox.ry;
        let rw = dragStartBox.rw;
        let rh = dragStartBox.rh;
        
        if (boxDragMode === 'resize-br') {
            rw = Math.max(0.01, Math.min(1 - rx, dragStartBox.rw + deltaX));
            rh = Math.max(0.01, Math.min(1 - ry, dragStartBox.rh + deltaY));
        } else if (boxDragMode === 'resize-bl') {
            const maxDeltaX = dragStartBox.rw - 0.01;
            const actualDeltaX = Math.min(maxDeltaX, Math.max(-dragStartBox.rx, deltaX));
            rx = dragStartBox.rx + actualDeltaX;
            rw = dragStartBox.rw - actualDeltaX;
            rh = Math.max(0.01, Math.min(1 - ry, dragStartBox.rh + deltaY));
        } else if (boxDragMode === 'resize-tr') {
            rw = Math.max(0.01, Math.min(1 - rx, dragStartBox.rw + deltaX));
            const maxDeltaY = dragStartBox.rh - 0.01;
            const actualDeltaY = Math.min(maxDeltaY, Math.max(-dragStartBox.ry, deltaY));
            ry = dragStartBox.ry + actualDeltaY;
            rh = dragStartBox.rh - actualDeltaY;
        } else if (boxDragMode === 'resize-tl') {
            const maxDeltaX = dragStartBox.rw - 0.01;
            const actualDeltaX = Math.min(maxDeltaX, Math.max(-dragStartBox.rx, deltaX));
            rx = dragStartBox.rx + actualDeltaX;
            rw = dragStartBox.rw - actualDeltaX;
            
            const maxDeltaY = dragStartBox.rh - 0.01;
            const actualDeltaY = Math.min(maxDeltaY, Math.max(-dragStartBox.ry, deltaY));
            ry = dragStartBox.ry + actualDeltaY;
            rh = dragStartBox.rh - actualDeltaY;
        }
        
        videoBoxes[activeBoxIndex].rx = rx;
        videoBoxes[activeBoxIndex].ry = ry;
        videoBoxes[activeBoxIndex].rw = rw;
        videoBoxes[activeBoxIndex].rh = rh;
        
        renderVideoOverlays();
        renderVideoTracks();
        return;
    }
    
    if (boxDragMode === 'create' && isSelectingVideo) {
        const rect = videoZoomWrapper.getBoundingClientRect();
        let currentX = (clientX - rect.left) / videoZoomLevel;
        let currentY = (clientY - rect.top) / videoZoomLevel;
        
        currentX = Math.max(0, Math.min(currentX, videoDisplayWidth));
        currentY = Math.max(0, Math.min(currentY, videoDisplayHeight));
        
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(startX - currentX);
        const h = Math.abs(startY - currentY);
        
        selectionOverlay.style.left = x + 'px';
        selectionOverlay.style.top = y + 'px';
        selectionOverlay.style.width = w + 'px';
        selectionOverlay.style.height = h + 'px';
        
        currentCoords = {
            rx: x / videoDisplayWidth,
            ry: y / videoDisplayHeight,
            rw: w / videoDisplayWidth,
            rh: h / videoDisplayHeight
        };
        
        const realX = Math.round(currentCoords.rx * videoPlayer.videoWidth);
        const realY = Math.round(currentCoords.ry * videoPlayer.videoHeight);
        const realW = Math.round(currentCoords.rw * videoPlayer.videoWidth);
        const realH = Math.round(currentCoords.rh * videoPlayer.videoHeight);
        
        document.getElementById('val-coords').textContent = `X:${realX}, Y:${realY}, W:${realW}, H:${realH}`;
    }
}

let videoBoxes = [];

function stopVideoSelection() {
    if (boxDragMode === 'create' && isSelectingVideo) {
        isSelectingVideo = false;
        if (currentCoords.rw > 0.005 && currentCoords.rh > 0.005) {
            const dur = videoPlayer ? (videoPlayer.duration || 0) : 0;
            videoBoxes.push({
                ...currentCoords,
                startTime: 0,
                endTime: parseFloat(dur.toFixed(1)) || 9999
            });
            activeBoxIndex = videoBoxes.length - 1;
            showToast(`已添加第 ${videoBoxes.length} 个框选区域`, 'success');
        }
        currentCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
        selectionOverlay.style.display = 'none';
        renderVideoOverlays();
        renderVideoTracks();
    }
    boxDragMode = null;
    dragStartBox = null;
}

function renderVideoOverlays() {
    const container = document.getElementById('video-overlays-container');
    if (!container) return;
    container.innerHTML = '';
    
    const curTime = videoPlayer ? videoPlayer.currentTime : 0;
    
    videoBoxes.forEach((box, idx) => {
        const isCurrentActive = (curTime >= (box.startTime || 0) && curTime <= (box.endTime || 99999));
        
        const overlay = document.createElement('div');
        overlay.className = `selection-overlay ${idx === activeBoxIndex ? 'active' : ''}`;
        overlay.dataset.boxIndex = idx;
        overlay.style.left = (box.rx * videoDisplayWidth) + 'px';
        overlay.style.top = (box.ry * videoDisplayHeight) + 'px';
        overlay.style.width = (box.rw * videoDisplayWidth) + 'px';
        overlay.style.height = (box.rh * videoDisplayHeight) + 'px';
        overlay.style.display = 'block';
        
        if (!isCurrentActive) {
            overlay.style.opacity = '0.35';
            overlay.style.borderStyle = 'dashed';
        }
        
        overlay.innerHTML = `
            <span class="box-num-badge">#${idx + 1}</span>
            <div class="selection-corner top-left"></div>
            <div class="selection-corner top-right"></div>
            <div class="selection-corner bottom-left"></div>
            <div class="selection-corner bottom-right"></div>
        `;
        container.appendChild(overlay);
    });
    
    const coordsVal = document.getElementById('val-coords');
    if (coordsVal) {
        if (videoBoxes.length === 0) {
            coordsVal.textContent = '未选择';
        } else {
            coordsVal.textContent = `已选择 ${videoBoxes.length} 个区域`;
        }
    }
}

function renderVideoTracks() {
    const section = document.getElementById('video-tracks-section');
    const list = document.getElementById('video-tracks-list');
    if (!section || !list) return;
    
    if (videoBoxes.length === 0) {
        section.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    
    section.style.display = 'flex';
    list.innerHTML = '';
    
    const curTime = videoPlayer ? videoPlayer.currentTime : 0;
    const dur = videoPlayer ? (videoPlayer.duration || 100) : 100;
    
    videoBoxes.forEach((box, idx) => {
        const realX = Math.round(box.rx * (videoPlayer.videoWidth || 1920));
        const realY = Math.round(box.ry * (videoPlayer.videoHeight || 1080));
        const realW = Math.round(box.rw * (videoPlayer.videoWidth || 1920));
        const realH = Math.round(box.rh * (videoPlayer.videoHeight || 1080));
        
        const sTime = box.startTime !== undefined ? box.startTime : 0;
        const eTime = box.endTime !== undefined ? box.endTime : parseFloat(dur.toFixed(1));
        
        const isActive = (curTime >= sTime && curTime <= eTime);
        
        const trackItem = document.createElement('div');
        trackItem.className = `track-item ${isActive ? '' : 'inactive'}`;
        trackItem.innerHTML = `
            <div class="track-info">
                <span class="box-num-badge static">#${idx + 1}</span>
                <span class="track-coords-text">X:${realX}, Y:${realY} (${realW}x${realH})</span>
            </div>
            
            <div class="track-time-controls">
                <div class="time-input-group">
                    <label>起点</label>
                    <input type="number" step="0.1" min="0" max="${dur.toFixed(1)}" class="track-time-input" value="${sTime}" onchange="updateTrackTime(${idx}, 'start', this.value)">
                    <button class="btn-xs" onclick="setTrackTime(${idx}, 'start')" title="将当前播放秒数设为起点">
                        <i data-lucide="map-pin"></i> 设当前
                    </button>
                </div>
                
                <span class="time-separator">至</span>
                
                <div class="time-input-group">
                    <label>终点</label>
                    <input type="number" step="0.1" min="0" max="${dur.toFixed(1)}" class="track-time-input" value="${eTime}" onchange="updateTrackTime(${idx}, 'end', this.value)">
                    <button class="btn-xs" onclick="setTrackTime(${idx}, 'end')" title="将当前播放秒数设为终点">
                        <i data-lucide="map-pin"></i> 设当前
                    </button>
                </div>
                
                <button class="track-delete-btn" onclick="deleteVideoBox(${idx})" title="删除此框选轨道">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        list.appendChild(trackItem);
    });
    
    if (window.lucide) lucide.createIcons();
}

function updateTrackTime(idx, type, val) {
    if (!videoBoxes[idx]) return;
    const num = parseFloat(val) || 0;
    if (type === 'start') {
        videoBoxes[idx].startTime = Math.max(0, num);
    } else if (type === 'end') {
        videoBoxes[idx].endTime = Math.max(0, num);
    }
    renderVideoOverlays();
    renderVideoTracks();
}

function setTrackTime(idx, type) {
    if (!videoBoxes[idx] || !videoPlayer) return;
    const cur = parseFloat((videoPlayer.currentTime || 0).toFixed(1));
    if (type === 'start') {
        videoBoxes[idx].startTime = cur;
        showToast(`已将 #${idx + 1} 起点设为 ${cur}s`, 'success');
    } else if (type === 'end') {
        videoBoxes[idx].endTime = cur;
        showToast(`已将 #${idx + 1} 终点设为 ${cur}s`, 'success');
    }
    renderVideoOverlays();
    renderVideoTracks();
}

function deleteVideoBox(idx) {
    if (idx >= 0 && idx < videoBoxes.length) {
        videoBoxes.splice(idx, 1);
        renderVideoOverlays();
        renderVideoTracks();
        showToast('已删除框选轨道', 'info');
    }
}

// External Video Playback Controls logic
function toggleVideoPlay() {
    if (!videoPlayer) return;
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

function updatePlayPauseIcon() {
    const icon = document.getElementById('video-play-icon');
    if (!icon) return;
    if (videoPlayer.paused) {
        icon.setAttribute('data-lucide', 'play');
    } else {
        icon.setAttribute('data-lucide', 'pause');
    }
    if (window.lucide) lucide.createIcons();
}

function toggleVideoMute() {
    if (!videoPlayer) return;
    videoPlayer.muted = !videoPlayer.muted;
    updateMuteIcon();
}

function updateMuteIcon() {
    const icon = document.getElementById('video-mute-icon');
    if (!icon) return;
    if (videoPlayer.muted) {
        icon.setAttribute('data-lucide', 'volume-x');
    } else {
        icon.setAttribute('data-lucide', 'volume-2');
    }
    if (window.lucide) lucide.createIcons();
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function seekVideo(val) {
    if (!videoPlayer || !videoPlayer.duration) return;
    videoPlayer.currentTime = (val / 100) * videoPlayer.duration;
}

videoPlayer.addEventListener('play', updatePlayPauseIcon);
videoPlayer.addEventListener('pause', updatePlayPauseIcon);
videoPlayer.addEventListener('timeupdate', () => {
    if (!videoPlayer.duration) return;
    const timeline = document.getElementById('video-timeline');
    const curTime = document.getElementById('video-time-current');
    const durTime = document.getElementById('video-time-duration');
    
    if (timeline) timeline.value = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    if (curTime) curTime.textContent = formatTime(videoPlayer.currentTime);
    if (durTime) durTime.textContent = formatTime(videoPlayer.duration);
    
    renderVideoOverlays();
    renderVideoTracks();
});

// Touch support for Video selection
videoZoomWrapper.addEventListener('touchstart', (e) => {
    if (videoTool === 'rect' && e.touches.length > 0) {
        startVideoSelection(e.touches[0]);
    }
});

videoZoomWrapper.addEventListener('touchmove', (e) => {
    if (isSelectingVideo && e.touches.length > 0) {
        drawVideoSelection(e.touches[0]);
    }
});

videoZoomWrapper.addEventListener('touchend', stopVideoSelection);

// Video Panning events
videoScrollContainer.addEventListener('mousedown', (e) => {
    if (videoTool === 'pan') {
        isPanningVideo = true;
        videoScrollContainer.style.cursor = 'grabbing';
        panStartX = e.clientX;
        panStartY = e.clientY;
        scrollLeftStart = videoScrollContainer.scrollLeft;
        scrollTopStart = videoScrollContainer.scrollTop;
        e.preventDefault();
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanningVideo && videoTool === 'pan') {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        videoScrollContainer.scrollLeft = scrollLeftStart - dx;
        videoScrollContainer.scrollTop = scrollTopStart - dy;
    } else if (boxDragMode && videoTool === 'rect') {
        drawVideoSelection(e);
    }
});

window.addEventListener('mouseup', () => {
    if (isPanningVideo) {
        isPanningVideo = false;
        videoScrollContainer.style.cursor = 'grab';
    }
    if (boxDragMode) {
        stopVideoSelection();
    }
});

// Touch support for video panning
videoScrollContainer.addEventListener('touchstart', (e) => {
    if (videoTool === 'pan' && e.touches.length > 0) {
        isPanningVideo = true;
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        scrollLeftStart = videoScrollContainer.scrollLeft;
        scrollTopStart = videoScrollContainer.scrollTop;
    }
}, { passive: true });

videoScrollContainer.addEventListener('touchmove', (e) => {
    if (isPanningVideo && videoTool === 'pan' && e.touches.length > 0) {
        const dx = e.touches[0].clientX - panStartX;
        const dy = e.touches[0].clientY - panStartY;
        videoScrollContainer.scrollLeft = scrollLeftStart - dx;
        videoScrollContainer.scrollTop = scrollTopStart - dy;
    }
}, { passive: true });

videoScrollContainer.addEventListener('touchend', () => {
    isPanningVideo = false;
});

function clearVideoSelection() {
    videoBoxes = [];
    currentCoords = { rx: 0, ry: 0, rw: 0, rh: 0 };
    selectionOverlay.style.display = 'none';
    renderVideoOverlays();
    renderVideoTracks();
    showToast('选框已重置', 'success');
}

// Preset Gemini Watermark (Video)
document.getElementById('gemini-video-preset-btn').addEventListener('click', () => {
    if (!videoPlayer.videoWidth) return;
    
    const videoW = videoPlayer.videoWidth;
    const videoH = videoPlayer.videoHeight;
    
    const realW = Math.min(videoW, 256);
    const realH = Math.min(videoH, 256);
    
    const rightMargin = Math.min(videoW * 0.03, 60);
    const bottomMargin = Math.min(videoH * 0.03, 60);
    
    const realX = videoW - realW - rightMargin;
    const realY = videoH - realH - bottomMargin;
    
    const dur = videoPlayer ? (videoPlayer.duration || 0) : 0;
    const presetBox = {
        rx: Math.max(0, realX / videoW),
        ry: Math.max(0, realY / videoH),
        rw: realW / videoW,
        rh: realH / videoH,
        startTime: 0,
        endTime: parseFloat(dur.toFixed(1)) || 9999
    };
    
    videoBoxes.push(presetBox);
    renderVideoOverlays();
    renderVideoTracks();
    showToast('已添加 Gemini 预设选框！', 'success');
});

// Set Video Removal Mode
function setVideoMode(mode) {
    videoMode = mode;
    document.getElementById('video-mode-fast-btn').classList.remove('active');
    document.getElementById('video-mode-ai-btn').classList.remove('active');
    
    if (mode === 'fast') {
        document.getElementById('video-mode-fast-btn').classList.add('active');
        showToast('已选择极速模式（推荐，1~2秒完成）', 'success');
    } else if (mode === 'ai') {
        document.getElementById('video-mode-ai-btn').classList.add('active');
        showToast('已选择 AI 逐帧模式', 'info');
    }
}

// Process Video
function processVideo() {
    if (!selectedVideoFile) return;
    
    let allBoxes = [...videoBoxes];
    if (currentCoords.rw > 0.005 && currentCoords.rh > 0.005) {
        const dur = videoPlayer ? (videoPlayer.duration || 0) : 0;
        allBoxes.push({
            ...currentCoords,
            startTime: 0,
            endTime: parseFloat(dur.toFixed(1)) || 9999
        });
    }
    
    if (allBoxes.length === 0) {
        showToast('请先框选需要消除的水印区域。', 'error');
        return;
    }
    
    if (videoMode === 'ai') {
        showLoader('AI 正在消除水印...');
        updateLoaderSubtext(`正在处理 ${allBoxes.length} 个区域，使用 LaMa 神经网络`);
    } else {
        showLoader('正在消除水印...');
        updateLoaderSubtext(`OpenCV (FFmpeg) 正在处理 ${allBoxes.length} 个区域`);
    }
    
    const realBoxes = allBoxes.map(b => ({
        x: Math.round(b.rx * videoPlayer.videoWidth),
        y: Math.round(b.ry * videoPlayer.videoHeight),
        w: Math.round(b.rw * videoPlayer.videoWidth),
        h: Math.round(b.rh * videoPlayer.videoHeight),
        start_time: b.startTime !== undefined ? b.startTime : 0,
        end_time: b.endTime !== undefined ? b.endTime : 99999
    }));
    
    const formData = new FormData();
    formData.append('video', selectedVideoFile);
    formData.append('x', realBoxes[0].x);
    formData.append('y', realBoxes[0].y);
    formData.append('w', realBoxes[0].w);
    formData.append('h', realBoxes[0].h);
    formData.append('boxes_json', JSON.stringify(realBoxes));
    formData.append('mode', videoMode);
    
    fetch('/api/remove-watermark/video', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error('服务器处理视频失败');
        return response.blob();
    })
    .then(cleanedBlob => {
        const cleanedUrl = URL.createObjectURL(cleanedBlob);
        
        // Show result, hide editor
        document.getElementById('video-editor').style.display = 'none';
        document.getElementById('video-result-container').style.display = 'block';
        
        // Setup players
        document.getElementById('video-result-before-player').src = URL.createObjectURL(selectedVideoFile);
        document.getElementById('video-result-after-player').src = cleanedUrl;
        
        // Setup download link
        document.getElementById('download-video-btn').href = cleanedUrl;
        
        hideLoader();
        showToast('视频处理完成！', 'success');
        lucide.createIcons();
    })
    .catch(err => {
        hideLoader();
        showToast(err.message, 'error');
    });
}

function resetVideoEditor() {
    document.getElementById('video-result-container').style.display = 'none';
    document.getElementById('video-editor').style.display = 'block';
    clearVideoSelection();
    lucide.createIcons();
}

// Initialize components on page load
window.addEventListener('load', () => {
    const slider = document.getElementById('tab-indicator');
    const activeBtn = document.getElementById('tab-image-btn');
    if (slider && activeBtn) {
        slider.style.width = activeBtn.offsetWidth + 'px';
    }
    
    if (window.lucide) {
        lucide.createIcons();
    }
});
