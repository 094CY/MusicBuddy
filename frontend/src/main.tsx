// origin: 094CY/MusicBuddy
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 注册 Service Worker（仅生产环境 + 非 Electron）
if (import.meta.env.PROD && 'serviceWorker' in navigator && !(window as any).electronAPI) {
  window.addEventListener('load', () => {
    // base 为 './'，用页面 URL 解析出正确的子路径，避免部署在子目录时 404
    const swUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href).toString();
    navigator.serviceWorker.register(swUrl).then((registration) => {
      // 发现新版本：通知 UI 显示「有新版本可用」提示
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('musicbuddy:app-update', { detail: { worker: installing } }));
          }
        });
      });
    }).catch(() => { /* 注册失败不影响主功能 */ });

    // SW 接管后刷新一次，确保用上最新资源
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  });
}
