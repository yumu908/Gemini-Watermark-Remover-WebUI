@echo off
title Gemini 水印消除服务器
cd /d "%~dp0"
echo 正在激活虚拟环境...
if not exist venv\Scripts\activate.bat (
    echo 错误: 未找到虚拟环境 (venv)，请先运行 run.ps1 进行配置。
    pause
    exit /b
)
call venv\Scripts\activate.bat
echo 正在启动开发服务器 http://127.0.0.1:8000 ...
python backend/main.py
pause
