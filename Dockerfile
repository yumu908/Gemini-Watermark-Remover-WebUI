FROM python:3.10-slim

# Set environment variables to optimize Python within Docker
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install system dependencies for OpenCV and FFmpeg
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install lightweight CPU-only version of PyTorch first to keep the container small
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install FastAPI dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy source code and template assets
COPY backend /app/backend
COPY frontend /app/frontend
COPY masks /app/masks

# Create temporary upload folder and configure broad write permissions for Hugging Face non-root user (UID 1000)
RUN mkdir -p /app/backend/temp && chmod -R 777 /app

# Hugging Face Spaces routes traffic to port 7860 by default
EXPOSE 7860

# Start FastAPI application
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
