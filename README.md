---
title: Gemini Watermark Remover
emoji: 🌌
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🌌 Gemini Watermark Remover

一款基于 **OpenCV 数学图像恢复** 与 **LaMa (Large Mask Inpainting) AI 深度学习** 的智能无痕水印消除与遮挡修复系统。支持图片与视频水印消除、多区域标注、时间轴控制，并提供基于 CUDA 的 GPU 加速。

---

## 🌟 核心功能亮点

- 🖼️ **图片无痕消除**：支持自动定位已知水印模板（标准水印）、反向色彩重构（数学无痕恢复）以及针对复杂遮挡对象的 LaMa AI 局部重构。
- 🎥 **视频水印消除**：
  - **多区域同时消除 (Multi-box)**：支持在视频画布上框选多个不同的水印区域。
  - **时间轴动态范围**：可针对每个选框单独设置水印出现的起止时间（秒）。
  - **多模式切换**：提供 OpenCV 快速修复及 LaMa AI 神经网络帧重构模式。
- ⚡ **CUDA GPU 加速**：自动检测 NVIDIA GPU 显卡，启用 CUDA 硬件加速推理。
- 🛡️ **商业级代码保护与打包**：内置 PyArmor 代码加密混淆及 PyInstaller 绿色免安装运行包导出工具。
- 📱 **Android 移动端模型支持**：提供大模型切片与移动端资产导出脚本。

---

[快速访问](https://watermark.qianche.dpdns.org/)

## 一键部署

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyumu908%2FGemini-Watermark-Remover-WebUI&project-name=gemini-watermark-remover&repository-name=Gemini-Watermark-Remover-WebUI)

### Cloudflare（Workers）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yumu908/Gemini-Watermark-Remover-WebUI)

- 点击上方按钮，按向导授权并创建项目即可自动构建与发布。
- 若你已 fork 本仓库，点击后可在向导中选择你的 fork 进行部署。

---

## 🚀 快速启动与本地部署

### 1. 环境准备

- **操作系统**：Windows 10 / 11 或 Linux
- **Python 环境**：Python 3.10 / 3.11 / 3.12 (推荐使用带有 CUDA 12.x 支持的 PyTorch)
- **依赖工具**：FFmpeg (系统环境变量中或在 LOCALAPPDATA WinGet 路径下)

### 2. 创建 Python 虚拟环境 (Virtual Environment)

在项目根目录下执行以下命令创建并激活独立的 Python 虚拟环境：

**Windows (CMD / PowerShell)**：

```cmd
# 创建虚拟环境 (创建在根目录 venv 文件夹)
python -m venv venv

# 激活虚拟环境 (PowerShell)
.\run.ps1
```

**Linux / macOS**：

```bash
# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate
```

### 3. 一键启动开发服务器

在项目根目录下，直接在 PowerShell 中运行：

```powershell
.\run.ps1
```

启动成功后，浏览器会自动打开或访问：`http://127.0.0.1:8000`

---

## 📦 代码混淆与独立可执行运行包打包

项目内置了自动化的 **PyArmor 代码混淆加密** 与 **PyInstaller 独立绿色运行包导出** 工具，能够将 Python 后端源码加密并打包为不需要配置 Python 环境的桌面应用。

---

## 🐳 Docker 容器化部署

项目包含 `Dockerfile`，支持一键打包为 Docker 镜像并在服务器部署：

```bash
# 构建 Docker 镜像
docker build -t watermark-remover:latest .

# 运行 Docker 容器
docker run -d -p 7860:7860 --gpus all --name watermark-remover watermark-remover:latest
```

---

## 📁 项目目录结构

```text
watermark-remover/
├── backend/                  # 后端 FastAPI 业务逻辑与 AI 推理引擎
│   ├── main.py               # 服务端入口
│   └── requirements.txt      # 后端依赖配置
├── frontend/                 # 现代化前端网页界面 (HTML/CSS/JS)
│   ├── index.html            # 主界面
│   ├── style.css             # 自定义玻璃拟态与现代化样式
│   ├── app.js                # 交互与画布选框逻辑
│   └── favicon.ico           # Web Favicon 图标
├── masks/                    # 已收录的标准水印反向遮罩模板
├── vercel.json               # Vercel 一键部署路由重定向配置
├── Dockerfile                # Docker 镜像构建文件
├── run.ps1                   # PowerShell 一键启动与依赖安装
├── run_server.bat            # 批处理启动脚本
└── README.md                 # 项目说明文档
```
