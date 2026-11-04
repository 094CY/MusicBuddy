import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 每次构建生成唯一 ID，注入到 sw.js，使浏览器能识别新版本并清理旧缓存
const BUILD_ID = Date.now().toString(36)

// 移除 index.html 中的 crossorigin 属性（file:// 协议下会导致资源加载失败）
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    closeBundle() {
      const indexPath = path.resolve(__dirname, 'dist/index.html')
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf-8')
        html = html.replace(/crossorigin\s*/g, '')
        fs.writeFileSync(indexPath, html)
      }
    },
  }
}

// 把构建 ID 写进 Service Worker 脚本内容：脚本字节变化才会触发浏览器 install/update
function injectServiceWorkerVersion(): Plugin {
  return {
    name: 'inject-sw-version',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js')
      if (!fs.existsSync(swPath)) return
      const sw = fs.readFileSync(swPath, 'utf-8')
      fs.writeFileSync(swPath, sw.replace(/__MUSICBUDDY_BUILD_ID__/g, BUILD_ID))
    },
  }
}

export default defineConfig({
  plugins: [react(), removeCrossorigin(), injectServiceWorkerVersion()],
  base: './',
  build: {
    modulePreload: false,
  },
  server: {
    port: 5173,
    host: true, // 监听 0.0.0.0，允许局域网设备访问
    proxy: {
      '/api': {
        target: 'http://localhost:3721',
        changeOrigin: true,
      },
    },
  },
})
