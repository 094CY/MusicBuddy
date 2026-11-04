// 运行环境检测 + API 地址
export function getApiBase(): string {
  // Electron 桌面版：直连本地后端
  if ((window as any).electronAPI?.isElectron === true) {
    return 'http://localhost:3721';
  }

  // Web / PWA：
  // 开发环境 localhost → Vite proxy（相对路径）
  // 开发环境局域网IP访问（手机） → 直连后端
  // 生产环境（HTTPS 域名）→ 相对路径（同域部署）
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return '';
  }
  if (window.location.protocol === 'https:') {
    return '';
  }
  return `http://${window.location.hostname}:3721`;
}

// 是否为 PWA 独立模式
export function isPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
}

// 是否为移动端浏览器（仅用于布局适配，不代表原生 App 支持）
export function isMobile(): boolean {
  const ua = navigator.userAgent;
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchstart' in window);
  const isPhone = /iPhone|iPod|Android/i.test(ua);
  return isPhone || isIPad || ('ontouchstart' in window && window.innerWidth <= 1024);
}

export function isTabletLandscape(): boolean {
  const ua = navigator.userAgent;
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchstart' in window);
  return isIPad && window.innerWidth >= 1024;
}

export function isElectron(): boolean {
  return (window as any).electronAPI?.isElectron === true;
}

// ===== 公网部署辅助工具 =====

export function getVisitorId(): string {
  const key = 'musicbuddy-visitor-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

const PASS_KEY = 'musicbuddy-access-pwd';
export function getAccessPassword(): string { return localStorage.getItem(PASS_KEY) || ''; }
export function setAccessPassword(pwd: string) { localStorage.setItem(PASS_KEY, pwd); }
export function clearAccessPassword() { localStorage.removeItem(PASS_KEY); }

/** 全局通知事件：任何组件都可监听后以 Toast 展示 */
export function notify(message: string, type: 'error' | 'success' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('musicbuddy:notice', { detail: { message, type } }));
}

/** 密码失效事件：PasswordGate 监听后重新弹门 */
function emitAuthRequired() {
  clearAccessPassword();
  window.dispatchEvent(new CustomEvent('musicbuddy:auth-required'));
}

export interface ApiFetchOptions extends RequestInit {
  /** 请求超时（毫秒）。不传则不超时，AI / yt-dlp 等长请求由调用方决定 */
  timeoutMs?: number;
}

// API 请求包装：自动附加凭据、统一 403 / 429 处理、可选超时与幂等重试
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs, ...rest } = options;
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`;
  const headers = new Headers(rest.headers);
  headers.set('x-visitor-id', getVisitorId());
  const pwd = getAccessPassword();
  if (pwd) headers.set('x-access-password', pwd);

  const method = (rest.method || 'GET').toUpperCase();
  const attempts = (method === 'GET' || method === 'HEAD') ? 2 : 1;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    // 外部 signal 与超时 signal 合并
    const onAbort = () => controller.abort();
    if (rest.signal) {
      if (rest.signal.aborted) controller.abort();
      else rest.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await fetch(url, { ...rest, headers, signal: controller.signal });

      if (response.status === 403) {
        emitAuthRequired();
        return response;
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        notify(retryAfter ? `请求过于频繁，请 ${retryAfter} 秒后再试` : '请求过于频繁，请稍后再试', 'error');
        return response;
      }
      // 幂等请求遇到 5xx / 网络抖动时退避重试一次
      if (response.status >= 500 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (rest.signal) rest.signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('网络请求失败');
}
