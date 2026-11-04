/**
 * 外部服务配置。
 *
 * 本项目不绑定任何 AI / 语音服务商：所有地址、密钥、模型与音色都通过环境变量注入。
 * 只要求「OpenAI 兼容」的 HTTP 接口，使用者可以接入自建服务或任意兼容服务。
 * 一组旧版配置变量名通过 compat.ts 兼容，保证已有本地配置无需改动。
 */

import { LEGACY_ENV, DEFAULT_TTS_VOICE_TYPE, DEFAULT_TTS_VOICE_FALLBACK } from './compat';

function pick(...values: (string | undefined)[]): string {
  return values.find((v) => typeof v === 'string' && v.trim() !== '')?.trim() || '';
}

/** 按别名列表读取旧版变量，返回第一个非空值 */
function legacy(keys: readonly string[]): string {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export interface LLMSettings {
  apiKey: string;
  baseURL: string;
  model: string;
  configured: boolean;
}

/** 读取 LLM 配置。task 用于支持按任务指定不同模型。 */
export function getLLMSettings(task?: 'recommend' | 'chat' | 'dj' | 'extract'): LLMSettings {
  const apiKey = pick(process.env.LLM_API_KEY, legacy(LEGACY_ENV.llmApiKey));
  const baseURL = pick(process.env.LLM_BASE_URL, legacy(LEGACY_ENV.llmBaseUrl));
  const suffix = task ? task.toUpperCase() : '';
  const taskModel = suffix
    ? pick(process.env[`LLM_MODEL_${suffix}`], process.env[`AI_MODEL_${suffix}`])
    : '';
  const model = taskModel || pick(process.env.LLM_MODEL, legacy(LEGACY_ENV.llmModel));
  return { apiKey, baseURL, model, configured: Boolean(apiKey && baseURL) };
}

/** 未显式指定模型时，向兼容接口查询可用模型并取第一个，避免写死任何模型名。 */
let cachedModel = '';
let cachedModelAt = 0;
export async function resolveModel(settings: LLMSettings): Promise<string> {
  if (settings.model) return settings.model;
  if (cachedModel && Date.now() - cachedModelAt < 10 * 60 * 1000) return cachedModel;
  try {
    const url = `${settings.baseURL.replace(/\/$/, '')}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const data: unknown = await res.json();
    const list = (data as { data?: { id?: string }[] })?.data;
    const id = Array.isArray(list) ? list.find((m) => typeof m.id === 'string')?.id : '';
    if (id) {
      cachedModel = id;
      cachedModelAt = Date.now();
      return id;
    }
  } catch { /* 查询失败时由调用方给出明确提示 */ }
  return '';
}

export type TTSProvider = 'openai-compatible' | 'sdk' | 'none';

export interface TTSSettings {
  provider: TTSProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  voice: string;
  secretId: string;
  secretKey: string;
  region: string;
  voiceType: number;
  fallbackVoiceType: number;
  configured: boolean;
}

/**
 * 语音合成配置。两种接入方式：
 *  - openai-compatible：调用任意兼容 /audio/speech 的 HTTP 接口（推荐）
 *  - sdk：使用可选 SDK 适配器（兼容已有本地配置）
 * 未配置任何凭据时 provider = none，DJ 播报自动静默关闭，不影响播放。
 */
export function getTTSSettings(): TTSSettings {
  const explicit = pick(process.env.TTS_PROVIDER).toLowerCase();
  const secretId = pick(process.env.TTS_SECRET_ID, legacy(LEGACY_ENV.ttsSecretId));
  const secretKey = pick(process.env.TTS_SECRET_KEY, legacy(LEGACY_ENV.ttsSecretKey));
  const apiKey = pick(process.env.TTS_API_KEY, process.env.LLM_API_KEY, legacy(LEGACY_ENV.llmApiKey));
  const baseURL = pick(process.env.TTS_BASE_URL, process.env.LLM_BASE_URL, legacy(LEGACY_ENV.llmBaseUrl));

  let provider: TTSProvider;
  if (explicit === 'none' || explicit === 'off' || explicit === 'disabled') provider = 'none';
  else if (explicit === 'openai' || explicit === 'openai-compatible' || explicit === 'http') provider = 'openai-compatible';
  else if (explicit === 'sdk') provider = 'sdk';
  else if (secretId && secretKey) provider = 'sdk';
  else if (apiKey && baseURL) provider = 'openai-compatible';
  else provider = 'none';

  return {
    provider,
    apiKey,
    baseURL,
    model: pick(process.env.TTS_MODEL),
    voice: pick(process.env.TTS_VOICE),
    secretId,
    secretKey,
    region: pick(process.env.TTS_REGION, legacy(LEGACY_ENV.ttsRegion)),
    voiceType: Number(pick(process.env.TTS_VOICE_TYPE) || DEFAULT_TTS_VOICE_TYPE),
    fallbackVoiceType: Number(pick(process.env.TTS_VOICE_FALLBACK) || DEFAULT_TTS_VOICE_FALLBACK),
    configured: provider === 'sdk' ? Boolean(secretId && secretKey) : Boolean(apiKey && baseURL),
  };
}
