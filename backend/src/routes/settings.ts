import { Router } from 'express';
import { getPublicSettings, saveSettings } from '../config/settings';
import { getLLMSettings, getTTSSettings } from '../config/services';

const router = Router();

/** 读取当前配置（密钥不回显）与服务可用状态 */
router.get('/', (_req, res) => {
  const llm = getLLMSettings();
  const tts = getTTSSettings();
  res.json({
    values: getPublicSettings(),
    status: {
      llmConfigured: llm.configured,
      ttsEnabled: tts.provider !== 'none' && tts.configured,
      ttsProvider: tts.provider,
    },
  });
});

/** 保存配置：写入用户数据目录并立即生效 */
router.put('/', (req, res) => {
  try {
    const result = saveSettings(req.body?.values ?? req.body);
    const llm = getLLMSettings();
    const tts = getTTSSettings();
    res.json({
      ok: true,
      ...result,
      status: {
        llmConfigured: llm.configured,
        ttsEnabled: tts.provider !== 'none' && tts.configured,
        ttsProvider: tts.provider,
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '保存设置失败' });
  }
});

export default router;
