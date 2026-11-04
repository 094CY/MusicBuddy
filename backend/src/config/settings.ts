import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 运行时设置：由前端设置面板写入，保存在用户数据目录（不进仓库、不进应用包）。
 * 优先级高于 .env，便于使用者在界面里直接改配置而无需改文件或重新打包。
 */

export const SETTING_KEYS = [
  'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL',
  'LLM_MODEL_RECOMMEND', 'LLM_MODEL_CHAT', 'LLM_MODEL_DJ', 'LLM_MODEL_EXTRACT',
  'TTS_PROVIDER', 'TTS_API_KEY', 'TTS_BASE_URL', 'TTS_MODEL', 'TTS_VOICE',
  'TTS_SECRET_ID', 'TTS_SECRET_KEY', 'TTS_REGION', 'TTS_SDK_MODULE',
  'YTMUSIC_API_KEY',
] as const;
export type SettingKey = typeof SETTING_KEYS[number];

const SECRET_KEYS = new Set<string>([
  'LLM_API_KEY', 'TTS_API_KEY', 'TTS_SECRET_ID', 'TTS_SECRET_KEY', 'YTMUSIC_API_KEY',
]);

function settingsDir(): string {
  if (process.env.DOTENV_PATH) return path.dirname(process.env.DOTENV_PATH);
  const local = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(local)) return local;
  return path.join(os.homedir(), '.musicbuddy');
}

function settingsPath(): string {
  return path.join(settingsDir(), 'settings.json');
}

let values: Partial<Record<SettingKey, string>> = {};

/** 启动时读取已保存的设置并应用到运行时环境 */
export function loadSettings(): void {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return;
    const raw: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    for (const key of SETTING_KEYS) {
      if (typeof obj[key] === 'string') {
        values[key] = obj[key] as string;
        if ((obj[key] as string) !== '') process.env[key] = obj[key] as string;
      }
    }
    console.log(`[settings] 已加载 ${Object.keys(values).length} 项运行时设置`);
  } catch (err: any) {
    console.warn('[settings] 读取失败:', err.message);
  }
}

/** 返回可安全展示的设置：密钥只回显「是否已配置」，绝不回传明文 */
export function getPublicSettings(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const fromEnv = process.env[key] || '';
    const value = values[key] ?? fromEnv;
    if (SECRET_KEYS.has(key)) {
      result[key] = Boolean(value);
      result[`${key}_SET`] = Boolean(value);
    } else {
      result[key] = value || '';
    }
  }
  return result;
}

/** 保存设置：仅接受白名单键；空字符串表示清除该项；密钥不写日志 */
export function saveSettings(input: unknown): { saved: number } {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确');
  const obj = input as Record<string, unknown>;
  const next = { ...values };
  const cleared: string[] = [];
  let saved = 0;

  for (const key of SETTING_KEYS) {
    if (!(key in obj)) continue;
    const raw = obj[key];
    if (raw !== null && typeof raw !== 'string' && typeof raw !== 'boolean') continue;
    // 密钥字段传 true 表示「保持不变」，传字符串表示更新
    if (SECRET_KEYS.has(key) && raw === true) continue;
    if (typeof raw === 'boolean') continue;
    const value = String(raw).trim();
    if (value.length > 2000) throw new Error(`${key} 值过长`);
    if (value === '') {
      delete next[key];
      cleared.push(key);
    } else {
      next[key] = value;
    }
    saved++;
  }

  const dir = settingsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = settingsPath();
  fs.writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* ignore */ }

  values = next;
  // 立即应用到运行时：本次清空或原本就没有的键，从环境中移除，避免 .env 旧值重新生效
  for (const key of cleared) delete process.env[key];
  for (const key of SETTING_KEYS) {
    const v = next[key];
    if (v) process.env[key] = v;
    else if (!(key in next)) delete process.env[key];
  }
  return { saved };
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}
