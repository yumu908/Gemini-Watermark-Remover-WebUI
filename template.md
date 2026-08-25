# HuggingFace Space Cloudflare Worker 免翻墙反代通用模板

本文档收录了将 HuggingFace Spaces 项目通过 Cloudflare Workers 反向代理到自定义域名的通用模板代码，支持国内网络免翻墙直连访问。

---

## 📋 模板一：Gradio / Python 动态应用反代模板（通用版）

> **适用于**：Gradio、Streamlit、ZeroGPU AI 模型等带有 Python 动态后端与语音/视频推流的应用。

```javascript
/**
 * =========================================================
 * Cloudflare Worker 反代模板 —— Gradio / Python 动态应用
 * 功能：CORS 跨域解封 + Gradio /config 域名重写 + WebSocket 推流支持
 * =========================================================
 */

// 1. 在这里配置你的 HuggingFace 信息
const HF_USERNAME = 'yumu908';        // HuggingFace 用户名
const HF_SPACE_NAME = 'ZipVoiceOnnx';   // HuggingFace Space 名称（大小写敏感均可，代码会自动处理小写转换）

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 自动将 Space 名称转为 HuggingFace 二级域名合规的全小写格式
    const cleanSpaceName = HF_SPACE_NAME.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const originDomain = `${HF_USERNAME.toLowerCase()}-${cleanSpaceName}.hf.space`;
    const targetUrl = `https://${originDomain}${url.pathname}${url.search}`;
    
    // 1. 自动响应浏览器的 OPTIONS 跨域预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 2. 伪造请求头，防盗链与后端安全穿透
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', originDomain);
    newHeaders.set('Origin', `https://${originDomain}`);
    newHeaders.set('Referer', `https://${originDomain}/`);
    
    // 3. Gradio 实时语音/推流 WebSocket 连接支持
    if (request.headers.get('Upgrade') === 'websocket') {
      return fetch(targetUrl, { headers: newHeaders, body: request.body });
    }

    // 4. 发起请求
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || '';
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    responseHeaders.delete('X-Frame-Options');
    responseHeaders.delete('Content-Security-Policy');

    // 5. 核心：重写 Gradio 配置文件与 HTML 中的硬编码域名，强制 API走 Cloudflare 节点
    if (contentType.includes('text/html') || contentType.includes('application/json') || url.pathname.includes('/config')) {
      let text = await response.text();
      text = text.replaceAll(`https://${originDomain}`, `https://${url.hostname}`);
      text = text.replaceAll(originDomain, url.hostname);
      
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
};
```

---

## 📋 模板二：Static 纯静态网页型反代模板（通用版）

> **适用于**：`sdk: static` 类型，如 WebAssembly (WASM)、ONNX 纯前端图像/语音推理网页。

```javascript
/**
 * =========================================================
 * Cloudflare Worker 反代模板 —— HuggingFace 静态网页 Space
 * 功能：自动匹配 .static.hf.space 域名 + 免翻墙加速
 * =========================================================
 */

// 1. 在这里配置你的 HuggingFace 信息
const HF_USERNAME = 'yumu908';           // HuggingFace 用户名
const HF_SPACE_NAME = 'pocket-tts-web';   // HuggingFace Space 名称

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    const cleanSpaceName = HF_SPACE_NAME.toLowerCase().replace(/[^a-z0-9-]/g, '');
    // 静态 Space 专属域名结构：<username>-<spacename>.static.hf.space
    const originDomain = `${HF_USERNAME.toLowerCase()}-${cleanSpaceName}.static.hf.space`;
    
    // 如果是通过子路径访问，自动剥离前缀；如果是独立子域名访问直接匹配
    let targetPath = url.pathname;
    if (targetPath.startsWith(`/${cleanSpaceName}`)) {
      targetPath = targetPath.replace(new RegExp(`^\\/${cleanSpaceName}`), '') || '/';
    }
    
    const targetUrl = `https://${originDomain}${targetPath}${url.search}`;
    
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', originDomain);
    newHeaders.set('Origin', `https://${originDomain}`);
    newHeaders.set('Referer', `https://${originDomain}/`);
    
    return fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow'
    });
  }
};
```

---

## 🛠️ 使用指引与注意事项

1. **域名命名规范**：
   - 绑定的自定义域名请使用**单层中划线格式**（如 `zipvoice.qianche.dpdns.org` 或 `pocket-tts.qianche.dpdns.org`）。
   - **请勿使用多个英文点**（如 `pocket.tts.qianche.dpdns.org`），否则 Cloudflare 免费版 SSL 证书无法覆盖多级通配符，会报 `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` 错误。

2. **区分 SDK 类型**：
   - 在 HuggingFace 新建 Space 时查看 `sdk` 字段。若为 `gradio` 则选 **模板一**，若为 `static` 则选 **模板二**。
