[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Check for Python
python --version > $null 2>&1
if ($LastExitCode -ne 0) {
    Write-Host "Error: Python not found. Please install Python 3." -ForegroundColor Red
    Exit 1
}

# Navigate to project directory
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
Set-Location $PSScriptRoot

# Create virtual environment if it doesn't exist
if (-not (Test-Path "venv")) {
    Write-Host "Creating Python virtual environment (venv)..." -ForegroundColor Cyan
    python -m venv venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Cyan
. venv\Scripts\Activate.ps1

# Install requirements
Write-Host "Installing dependencies..." -ForegroundColor Cyan
pip install --upgrade pip
Write-Host "Installing PyTorch (CPU version)..." -ForegroundColor Cyan
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r backend/requirements.txt

# Start server
Write-Host "Starting Watermark Remover Server on http://127.0.0.1:8000 ..." -ForegroundColor Green
python backend/main.py
