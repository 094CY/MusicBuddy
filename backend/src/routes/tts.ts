import { Router } from 'express';
import { getTTSSettings } from '../config/services';
import { DEFAULT_TTS_SDK_MODULE } from '../config/compat';

const router = Router();

const MAX_SEGMENT_LEN = 100;

/** 按标点把长文本切成短段，避免单次请求超长 */
function splitText(text: string, maxLen = MAX_SEGMENT_LEN): string[] {
  const segments: string[] = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (/[。！？；…]/.test(char) && current.length >= 20) {
      segments.push(current.trim());
      current = '';
    } else if (current.length >= maxLen) {
      segments.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.length ? segments : [text];
}

/** 方式一：调用任意兼容 /audio/speech 的语音接口，返回 base64 mp3 片段 */
async function synthViaHttp(text: string, speed: number, volume: number): Promise<string[]> {
  const cfg = getTTSSettings();
  const url = `${cfg.baseURL.replace(/\/$/, '')}/audio/speech`;
  const segments = splitText(text);

  const results = await Promise.all(segments.map(async (seg) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || undefined,
        input: seg,
        voice: cfg.voice || undefined,
        speed: typeof speed === 'number' ? speed : undefined,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`语音接口返回 ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('base64');
  }));
  return results;
}

/**
 * 方式二：可选的 SDK 适配器（兼容已有本地配置）。
 * 使用动态加载，未安装该依赖时不会影响其他接入方式，也不会导致开源版编译失败。
 */
async function synthViaSdk(text: string, speed: number, volume: number): Promise<string[]> {
  const cfg = getTTSSettings();
  // 可选适配器：模块名可配置，仅在显式选择 sdk 模式且配置了凭据时进入。
  const moduleName = process.env.TTS_SDK_MODULE || DEFAULT_TTS_SDK_MODULE;
  if (!moduleName) throw new Error('使用 sdk 模式时请设置 TTS_SDK_MODULE');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sdk = require(moduleName) as any;
  const client = new sdk.tts.v20190823.Client({
    credential: { secretId: cfg.secretId, secretKey: cfg.secretKey },
    region: cfg.region,
    profile: {},
  });

  const call = async (voiceType: number) => {
    const results = await Promise.all(splitText(text).map((seg, i) =>
      client.TextToVoice({
        Text: seg,
        VoiceType: voiceType,
        Speed: speed,
        Volume: volume,
        Codec: 'mp3',
        SessionId: `tts-${Date.now()}-${i}`,
      }).then((r: any) => ({ audio: r.Audio as string, index: i }))
    ));
    results.sort((a, b) => a.index - b.index);
    return results.map((r) => r.audio);
  };

  try {
    return await call(cfg.voiceType);
  } catch {
    return await call(cfg.fallbackVoiceType);
  }
}

router.post('/synthesize', async (req, res) => {
  try {
    const { text, speed = 0, volume = 0 } = req.body;
    if (!text) return res.status(400).json({ error: '缺少 text 参数' });

    const cfg = getTTSSettings();
    if (cfg.provider === 'none' || !cfg.configured) {
      return res.status(503).json({ error: '语音服务未配置，DJ 播报已关闭', code: 'TTS_DISABLED' });
    }

    let audioSegments: string[];
    try {
      audioSegments = cfg.provider === 'sdk'
        ? await synthViaSdk(text, speed, volume)
        : await synthViaHttp(text, speed, volume);
    } catch (err: any) {
      console.error('[tts] 合成失败:', err.message);
      return res.status(502).json({ error: '语音服务调用失败，请检查配置' });
    }

    res.json({ audioSegments, segmentCount: audioSegments.length });
  } catch (err: any) {
    console.error('[tts/synthesize]', err);
    res.status(500).json({ error: err.message || '语音合成失败' });
  }
});

/** 供前端判断是否展示 DJ 开关 */
router.get('/status', (_req, res) => {
  const cfg = getTTSSettings();
  res.json({ enabled: cfg.provider !== 'none' && cfg.configured, provider: cfg.provider });
});

export default router;
