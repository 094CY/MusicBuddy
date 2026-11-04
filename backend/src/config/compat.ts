/**
 * 本地兼容层（中性实现）。
 *
 * 本项目不绑定任何 AI / 语音服务商。此处保留一组空的兼容别名，
 * 供使用者在需要兼容自己旧版配置时填写；默认全部为空。
 * 所有实际配置请通过 .env 中的通用变量注入，见 .env.example。
 */

/** 旧版配置变量名 → 通用变量名的兼容别名（默认空） */
export const LEGACY_ENV = {
  llmApiKey: [],
  llmBaseUrl: [],
  llmModel: [],
  ttsSecretId: [],
  ttsSecretKey: [],
  ttsRegion: [],
} as const;

/** 可选 SDK 适配器的默认模块名；为空表示使用 sdk 模式时必须显式配置 TTS_SDK_MODULE */
export const DEFAULT_TTS_SDK_MODULE = '';

/** 本机 SDK 适配器使用的音色编号（通用实现不使用） */
export const DEFAULT_TTS_VOICE_TYPE = 0;
export const DEFAULT_TTS_VOICE_FALLBACK = 0;

/** 可选公开音源标识；为空表示该音源需使用者自行配置 YTMUSIC_API_KEY */
export const DEFAULT_PUBLIC_SOURCE_KEY = '';
