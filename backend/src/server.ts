import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// 优先级：1) Electron 传入的 DOTENV_PATH（userData 目录，安全） 2) backend/.env（仅开发）
const envCandidates = [
  process.env.DOTENV_PATH,
  path.resolve(__dirname, '../.env'),
].filter(Boolean) as string[];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    console.log('[Backend] 已加载环境变量:', p);
    break;
  }
}

// 防止第三方库内部未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException (已拦截，进程继续运行):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection (已拦截，进程继续运行):', reason);
});

import express from 'express';
import cors from 'cors';

import musicRoutes from './routes/music';
import aiRoutes from './routes/ai';
import ttsRoutes from './routes/tts';
import settingsRoutes from './routes/settings';
import { loadSettings } from './config/settings';

// 界面里保存的配置优先于 .env，需在路由读取 env 之前加载
loadSettings();

const app = express();
const PORT = Number(process.env.BACKEND_PORT || 3721);
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || ''; // 空字符串表示不开启

// 只有在明确配置了可信代理时，才采信 x-forwarded-for（否则可伪造绕过限流）
const TRUSTED_PROXY = (process.env.TRUSTED_PROXY || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

function getClientIp(req: express.Request): string {
  const direct = normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
  if (TRUSTED_PROXY.includes(direct)) {
    const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    if (forwarded) return normalizeIp(forwarded);
  }
  return direct;
}

// ===== 分级速率限制 =====
// 昂贵 LLM 调用（recommend / chat / dj-script / extract-memory）严格限流；
// 轻量埋点与记忆读写（feedback / memory）单独放宽，避免常驻电台把配额打满。
interface RateEntry { count: number; resetAt: number }
const rateMap = new Map<string, RateEntry>();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const EXPENSIVE_MAX = Number(process.env.AI_RATE_MAX || 60);
const LIGHT_MAX = Number(process.env.LIGHT_RATE_MAX || 600);
const EXPENSIVE_PATHS = ['/recommend', '/chat', '/dj-script', '/extract-memory'];

export function checkRateLimit(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_WINDOW_MS;
    rateMap.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }
  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key);
  }
}, 10 * 60 * 1000);

// ===== CORS 白名单 =====
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
  app.use(cors());
} else {
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
}

app.use(express.json({ limit: '10mb' }));

// ===== 公共端点（无需密码）=====
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 前端唯一的鉴权判据：是否启用密码 + 当前凭据是否有效
app.get('/api/auth/check', (req, res) => {
  const passwordRequired = Boolean(ACCESS_PASSWORD);
  const provided = req.headers['x-access-password'] || req.query['access_password'];
  const authenticated = !passwordRequired || provided === ACCESS_PASSWORD;
  res.json({ passwordRequired, authenticated });
});

// ===== 访问密码中间件：保护会消耗外部额度的接口 =====
const passwordGuard: express.RequestHandler = (req, res, next) => {
  if (!ACCESS_PASSWORD) return next();
  const pwd = req.headers['x-access-password'] || req.query['access_password'];
  if (pwd !== ACCESS_PASSWORD) {
    return res.status(403).json({ error: '访问密码错误', code: 'AUTH_REQUIRED' });
  }
  next();
};

// ===== /api/tts 单独限流（语音接口按调用计费，独立配额）=====
const ttsRate: express.RequestHandler = (req, res, next) => {
  const max = Number(process.env.TTS_RATE_MAX || 120);
  const { allowed, remaining, resetAt } = checkRateLimit(`${getClientIp(req)}|tts`, max);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (!allowed) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: '语音合成请求过于频繁，请稍后再试' });
  }
  next();
};

// 密码校验先于限流：未授权请求不应消耗配额
// 设置接口同样受保护：它能修改服务配置与凭据
app.use('/api/ai', passwordGuard);
app.use('/api/tts', passwordGuard, ttsRate);
app.use('/api/settings', passwordGuard);

app.use('/api/ai', (req, res, next) => {
  const expensive = EXPENSIVE_PATHS.some((p) => req.path.startsWith(p));
  const bucket = expensive ? 'expensive' : 'light';
  const max = expensive ? EXPENSIVE_MAX : LIGHT_MAX;
  const { allowed, remaining, resetAt } = checkRateLimit(`${getClientIp(req)}|${bucket}`, max);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Bucket', bucket);
  if (!allowed) {
    const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', String(seconds));
    return res.status(429).json({ error: `请求过于频繁，请 ${seconds} 秒后再试` });
  }
  next();
});

app.use('/api/music', musicRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/settings', settingsRoutes);

// ===== Web 形态：直接托管前端构建产物 =====
// 构建后一个端口即可提供页面 + API，无需额外 dev server 或反向代理。
// 源码运行与打包运行目录层级不同，按候选路径依次探测。
const FRONTEND_DIST = process.env.FRONTEND_DIST
  || [
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
  ].find((p) => fs.existsSync(path.join(p, 'index.html')))
  || path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  app.use(express.static(FRONTEND_DIST));
  // 非 /api 的 GET 请求回退到 index.html（SPA 入口）
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] MusicBuddy backend running on http://0.0.0.0:${PORT}`);
  if (ACCESS_PASSWORD) console.log('[server] 访问密码已启用');
  if (allowedOrigins.length) console.log('[server] CORS 白名单:', allowedOrigins);
  if (TRUSTED_PROXY.length) console.log('[server] 可信代理:', TRUSTED_PROXY);
  console.log(`[server] 限流：昂贵 LLM ${EXPENSIVE_MAX}/h，轻量埋点 ${LIGHT_MAX}/h`);
});
