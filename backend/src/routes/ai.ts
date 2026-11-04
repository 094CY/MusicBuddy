import { Router } from 'express';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getLLMSettings, resolveModel } from '../config/services';

const router = Router();

// 懒初始化：避免模块加载期固化 env，运行时修改配置也能生效
let cachedClient: OpenAI | null = null;
let cachedSignature = '';
function getClient(): OpenAI {
  const cfg = getLLMSettings();
  const signature = `${cfg.apiKey}|${cfg.baseURL}`;
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      timeout: 30_000,
      maxRetries: 1,
    });
    cachedSignature = signature;
  }
  return cachedClient;
}

interface CompletionParams {
  messages: unknown[];
  temperature?: number;
  max_tokens?: number;
}
interface CompletionResult {
  choices: { message?: { content?: string } }[];
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

// 统一入口：未配置服务时给出明确提示；未指定模型时自动探测可用模型
async function createCompletion(
  task: 'recommend' | 'chat' | 'dj' | 'extract',
  params: CompletionParams,
): Promise<CompletionResult> {
  const cfg = getLLMSettings(task);
  if (!cfg.configured) {
    throw new Error('AI 服务未配置：缺少 LLM_API_KEY 或 LLM_BASE_URL');
  }
  const model = await resolveModel(cfg);
  if (!model) {
    throw new Error('未指定模型且自动探测失败，请设置 LLM_MODEL');
  }
  const payload = { ...params, model } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  const result = await getClient().chat.completions.create(payload);
  return result as unknown as CompletionResult;
}

// ============================================================
// 记忆数据结构
// 分类记忆：每条记忆有 category（艺人/流派/情绪/场景/具体歌曲/否定偏好）+ 频次 + 时间衰减
// ============================================================
type MemoryCategory =
  | 'artist'      // 喜欢的艺人
  | 'genre'       // 流派/风格
  | 'mood'        // 情绪偏好（治愈/燃/怀旧）
  | 'scene'       // 场景（工作/睡前/通勤）
  | 'song'        // 具体歌曲喜好
  | 'dislike'     // 明确不喜欢
  | 'fact';       // 其他事实（如"用户在做某件事"）

interface MemoryEntry {
  content: string;        // 自然语言描述
  category: MemoryCategory;
  tag?: string;           // 关键标签（艺人名/流派名等），用于聚合
  polarity: 'positive' | 'negative';
  count: number;          // 提及次数（同 category+tag 累加）
  firstSeen: number;
  lastSeen: number;
  evidence?: string;      // 出自哪段对话（取片段，可选）
}

// 记忆目录（按 visitorId 分文件隔离）
const MEMORY_DIR = path.resolve(__dirname, '../../data/ai-memories');

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function getVisitorId(req: any): string {
  const vid = req.headers['x-visitor-id'] || req.query['visitor_id'];
  if (vid && typeof vid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(vid)) {
    return vid;
  }
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function getMemoryFile(visitorId: string): string {
  ensureMemoryDir();
  const safeId = visitorId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return path.join(MEMORY_DIR, `memory-${safeId}.json`);
}

function readMemory(visitorId: string): MemoryEntry[] {
  const file = getMemoryFile(visitorId);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(data)) return [];
    // 兼容旧格式：{content, timestamp} → 升级为 MemoryEntry
    return data.map((item: any): MemoryEntry => {
      if (item.category) return item as MemoryEntry;
      const ts = item.timestamp || Date.now();
      return {
        content: item.content || '',
        category: 'fact',
        polarity: 'positive',
        count: 1,
        firstSeen: ts,
        lastSeen: ts,
      };
    });
  } catch { return []; }
}

function writeMemory(visitorId: string, memory: MemoryEntry[]) {
  const file = getMemoryFile(visitorId);
  fs.writeFileSync(file, JSON.stringify(memory, null, 2), 'utf-8');
}

// ============================================================
// 记忆权重打分（频次 + 时间衰减）
// 越近期 + 越频繁 = 权重越高
// ============================================================
function scoreMemory(m: MemoryEntry, now = Date.now()): number {
  const ageDays = (now - m.lastSeen) / 86_400_000;
  // 半衰期 14 天
  const freshness = Math.exp(-ageDays / 14);
  return Math.log(1 + m.count) * 2 + freshness;
}

// 合并记忆：同 category+tag 的累加 count，更新 lastSeen
function mergeMemory(existing: MemoryEntry[], incoming: Partial<MemoryEntry>[]): MemoryEntry[] {
  const now = Date.now();
  const map = new Map<string, MemoryEntry>();
  for (const m of existing) {
    const key = `${m.category}::${(m.tag || m.content).toLowerCase()}::${m.polarity}`;
    map.set(key, m);
  }
  for (const inc of incoming) {
    if (!inc.content || !inc.category) continue;
    const polarity = inc.polarity || 'positive';
    const tag = inc.tag || inc.content;
    const key = `${inc.category}::${tag.toLowerCase()}::${polarity}`;
    const existed = map.get(key);
    if (existed) {
      existed.count += 1;
      existed.lastSeen = now;
      // 用最新版本的描述（更准确）
      if (inc.content.length > existed.content.length * 0.7) {
        existed.content = inc.content;
      }
      if (inc.evidence) existed.evidence = inc.evidence;
    } else {
      map.set(key, {
        content: inc.content,
        category: inc.category as MemoryCategory,
        tag: inc.tag,
        polarity,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        evidence: inc.evidence,
      });
    }
  }
  // 按权重排序，保留 Top 60（比之前 30 翻倍）
  const all = Array.from(map.values());
  all.sort((a, b) => scoreMemory(b) - scoreMemory(a));
  return all.slice(0, 60);
}

// ============================================================
// 构建注入给 LLM 的"用户画像"摘要
// 按分类聚合，权重排序，结构化文本
// ============================================================
function buildMemoryDigest(memory: MemoryEntry[], topPerCat = 8): string {
  if (!memory.length) return '';
  const byCat = new Map<MemoryCategory, MemoryEntry[]>();
  for (const m of memory) {
    if (!byCat.has(m.category)) byCat.set(m.category, []);
    byCat.get(m.category)!.push(m);
  }
  const sections: string[] = [];
  const labels: Record<MemoryCategory, string> = {
    artist: '【喜欢的艺人】',
    genre: '【偏好的流派/风格】',
    mood: '【情绪偏好】',
    scene: '【常用场景】',
    song: '【具体歌曲偏好】',
    dislike: '【明确不喜欢】',
    fact: '【其他了解】',
  };
  // 优先显示用户表达强烈的（艺人/流派/情绪），dislike 必须显示
  const order: MemoryCategory[] = ['artist', 'genre', 'mood', 'scene', 'dislike', 'song', 'fact'];
  for (const cat of order) {
    const items = byCat.get(cat);
    if (!items || !items.length) continue;
    items.sort((a, b) => scoreMemory(b) - scoreMemory(a));
    const top = items.slice(0, topPerCat);
    const lines = top.map((m) => {
      const cnt = m.count > 1 ? `×${m.count}` : '';
      return `  - ${m.content}${cnt}`;
    }).join('\n');
    sections.push(`${labels[cat]}\n${lines}`);
  }
  return sections.join('\n\n');
}

// ============================================================
// AI 推荐
// ============================================================
router.post('/recommend', async (req, res) => {
  try {
    const { prompt, history = [], musicProfile, behaviorSignals, recentlyRecommended = [] } = req.body;

    let userPrompt = prompt;
    if (!userPrompt && musicProfile) {
      userPrompt = `根据我的听歌画像，为我推荐 12-15 首歌曲。

${musicProfile}

请推荐我可能喜欢但最近没听过的歌曲。注意：
- 优先推荐与"喜欢的艺人"风格相近的其他艺人作品（拓展但不偏离）
- 避开"明确不喜欢"中提到的内容
- 优先推荐经典广为人知的歌曲（在各平台更易免费收听）
- 尽量覆盖不同歌手和风格`;
    }

    if (!userPrompt) {
      return res.status(400).json({ error: '缺少 prompt 或 musicProfile 参数' });
    }

    const visitorId = getVisitorId(req);
    const memory = readMemory(visitorId);
    const memoryDigest = buildMemoryDigest(memory);

    // 注入行为信号（来自前端的实时行为聚合）
    const behaviorText = behaviorSignals
      ? `\n用户实时行为信号：\n${behaviorSignals}`
      : '';

    // 构建"已推荐过的歌曲"去重区块（前端传入最近 N 首已推荐过的歌名+艺人）
    const recentList: string[] = Array.isArray(recentlyRecommended) ? recentlyRecommended.slice(0, 80) : [];
    const dedupeBlock = recentList.length > 0
      ? `\n=== 已推荐过的歌曲（严禁重复推荐） ===\n${recentList.join('\n')}\n=== 已推荐列表结束 ===\n\n【新鲜度硬约束】以上列表中的歌曲你已经推荐过了，用户不希望重复听到。本次推荐的 8 首歌中，**每一首都必须不在上述列表中**。请挖掘同一艺人的其他作品、同风格的其他艺人、或同年代的其他金曲来保证新鲜感。如果艺人池白名单中的艺人的常见代表作已经推荐过了，请推荐该艺人更冷门但仍有歌词的优质作品，或跳出白名单推荐风格一致的其他歌手。\n\n`
      : '';

    const systemPrompt = `你是一位深度懂用户的音乐 DJ，记忆系统已积累用户的长期偏好。你最重要的使命是**每次推荐都给用户带来新鲜感**——同一首歌绝不重复推荐。

${memoryDigest ? `=== 用户长期偏好画像 ===\n${memoryDigest}\n${behaviorText}\n=== 画像结束 ===\n\n` : behaviorText + '\n\n'}${dedupeBlock}请基于上述画像，推荐 8 首歌曲。要求：
1. 至少 2 首来自"喜欢的艺人"列表中艺人的其他作品（但必须是之前没推荐过的）
2. 至少 2 首是与画像风格相近的其他艺人作品（拓展发现新歌手）
3. 严格回避"明确不喜欢"中的艺人/流派
4. **必须推荐经典、广为流传、已发行多年的歌曲**（这样在各大音乐平台更容易找到免费可播放的版本）
5. **严禁推荐**：新歌（近 3 年发行）、独立厂牌单曲、冷门地下作品——这些在 QQ/网易云大概率是 VIP 才能听
6. **【正式发行版硬约束】只推荐正式发行的录音室版本。严禁以下任何非标准版本：演唱会 Live 版、现场版、音乐节版、综艺节目版（如中国好声音/我是歌手/CCTV 等节目翻唱）、DJ 版/Remix 混音版/电音版、翻唱 Cover 版、Demo 版、伴奏版、铃声版、短视频版。歌曲名中不应出现 (Live)、(DJ xxx版)、(CCTV-xx)、(Concert) 等后缀。**
7. **【最高优先级硬约束】只推荐有人声、有完整歌词的真实歌曲。严禁任何形式的纯音乐/纯旋律/纯钢琴/纯演奏曲/Lo-Fi beats/白噪音/ASMR/背景音乐/伴奏版/纯音乐 OST/电子氛围/ambient music。每一首都必须是歌手开口唱出歌词的版本。**
8. **【新鲜度约束】已推荐过的歌曲列表中出现的歌名+艺人组合，本次严禁再推荐。如果白名单艺人的热门曲都推荐过了，请推荐该艺人的非热门但仍经典的作品，或推荐风格相近的新艺人。**
9. 优先"国民级"作品：邓丽君、周杰伦、陈奕迅、王菲、李宗盛、五月天、老狼、朴树、许巍、陈绮贞等经典歌手的代表作
10. **歌曲名只输出最标准的正式名称**，不要带任何括号后缀。例如输出"野百合也有春天"而不是"野百合也有春天 (Live)"
11. 每首歌的"reason"解释为什么推荐（关联到用户画像中的具体偏好，20字以内）

输出 JSON：
{
  "mood": "整体氛围标签（如：治愈、燃、怀旧、专注）",
  "intro": "开场白，DJ口吻引用画像中的偏好（30字以内）",
  "songs": [
    { "name": "歌曲名（最常见标准名）", "artist": "艺人名", "reason": "推荐理由（20字以内）" }
  ]
}

只输出 JSON，不要其他文字。`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userPrompt },
    ];

    const completion = await createCompletion('recommend', {
      messages,
      temperature: 0.95,
      max_tokens: 1500,
    });

    const content = completion.choices[0]?.message?.content || '';

    let recommendation;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      recommendation = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      recommendation = null;
    }

    if (!recommendation) {
      return res.status(500).json({ error: 'AI 返回格式异常', raw: content });
    }

    res.json({
      recommendation,
      raw: content,
      usage: completion.usage,
      memoryUsed: memory.length,
    });
  } catch (err: any) {
    console.error('[ai/recommend]', err);
    res.status(500).json({ error: err.message || 'AI 推荐失败' });
  }
});

// ============================================================
// AI DJ 解说
// ============================================================
router.post('/dj-script', async (req, res) => {
  try {
    const { songName, artist, album, style = 'night', prevSong } = req.body;
    if (!songName || !artist) {
      return res.status(400).json({ error: '缺少歌曲信息' });
    }

    const styleConfig: Record<string, { system: string; tone: string }> = {
      night: { system: '你是一位深夜电台 DJ，声音温暖，对音乐有深刻理解，擅长用简短有力的语言把听众带入歌曲的氛围中。', tone: '温暖、有故事感，像在给老朋友讲故事' },
      energy: { system: '你是一位活力满满的早间电台 DJ，声音阳光有感染力，擅长用简洁有力的语言带动听众的情绪。', tone: '阳光活力、节奏明快，像在和朋友分享快乐' },
      literary: { system: '你是一位文艺清新的电台 DJ，声音柔和有诗意，擅长用文学化的语言描绘音乐中的意境。', tone: '文艺清新、有诗意，像在读一封手写信' },
    };
    const cfg = styleConfig[style] || styleConfig.night;

    const transitionHint = prevSong?.name
      ? `\n8. 上一首是《${prevSong.name}》(${prevSong.artist})，用一句自然过渡语衔接，如"从...到..."、"如果说...那么..."。过渡要简短自然。`
      : '';

    const userPrompt = `为歌曲《${songName}》生成一段电台 DJ 风格的解说。\n\n艺人：${artist}\n专辑：${album || '未知'}\n\n要求：\n1. 用中文输出，口吻${cfg.tone}\n2. 必须包含以下至少2个维度：歌曲创作背景、艺人故事、歌词隐喻、时代位置\n3. 150-200字，适合朗读，有呼吸感\n4. 开头每次不同风格（讲故事/感叹/时间回溯/提问/场景描写），禁止总用"你知道吗"\n5. 具体到歌名和艺人名\n6. 结尾有情感落点\n7. 禁止舞台指令和括号标注${transitionHint}`;

    const completion = await createCompletion('dj', {
      messages: [
        { role: 'system', content: cfg.system + ' 只输出纯解说文字，不要任何舞台指令或括号标注。' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens: 300,
    });

    let script = completion.choices[0]?.message?.content?.trim() || '';
    script = script.replace(/[（(][^）)]*[）)]/g, '').replace(/\s{2,}/g, ' ').trim();
    res.json({ script });
  } catch (err: any) {
    console.error('[ai/dj-script]', err);
    res.status(500).json({ error: err.message || '生成文案失败' });
  }
});

// ============================================================
// AI 记忆管理
// ============================================================
router.get('/memory', (req, res) => {
  try {
    const visitorId = getVisitorId(req);
    const memory = readMemory(visitorId);
    // 返回时附带数字摘要，供前端展示
    const digest = buildMemoryDigest(memory);
    res.json({ memory, digest, visitorId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 单条删除记忆（按 category::tag::polarity 定位，避免误删其他条目）
router.delete('/memory/:key', (req, res) => {
  try {
    const visitorId = getVisitorId(req);
    const key = decodeURIComponent(String(req.params.key || ''));
    const memory = readMemory(visitorId);
    const remaining = memory.filter((m) =>
      `${m.category}::${(m.tag || m.content).toLowerCase()}::${m.polarity}` !== key
    );
    if (remaining.length === memory.length) {
      return res.status(404).json({ error: '未找到该记忆条目' });
    }
    writeMemory(visitorId, remaining);
    res.json({ success: true, count: remaining.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 清空记忆（用户主动）
router.delete('/memory', (req, res) => {
  try {
    const visitorId = getVisitorId(req);
    writeMemory(visitorId, []);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 显式添加结构化记忆条目（前端用户行为信号触发）
router.post('/memory', (req, res) => {
  try {
    const { entry, entries } = req.body;
    const visitorId = getVisitorId(req);
    let memory = readMemory(visitorId);

    // 兼容旧格式：单条字符串
    if (typeof entry === 'string') {
      memory = mergeMemory(memory, [{
        content: entry,
        category: 'fact',
        polarity: 'positive',
      }]);
    } else if (Array.isArray(entries)) {
      memory = mergeMemory(memory, entries);
    } else {
      return res.status(400).json({ error: '需要 entry 字符串或 entries 数组' });
    }

    writeMemory(visitorId, memory);
    res.json({ success: true, count: memory.length });
  } catch (err: any) {
    console.error('[ai/memory]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AI 多轮对话
// ============================================================
router.post('/chat', async (req, res) => {
  try {
    const { messages = [], musicProfile } = req.body;

    const visitorId = getVisitorId(req);
    const memory = readMemory(visitorId);
    const memoryDigest = buildMemoryDigest(memory, 6);

    const systemPrompt = `你是用户的私人音乐助手，已经长期陪伴这位用户听歌，对TA的音乐口味有深入了解。

${memoryDigest ? `=== 用户长期偏好画像 ===\n${memoryDigest}\n=== 画像结束 ===\n\n` : ''}当前用户的实时音乐档案：
${musicProfile || '暂无档案'}

你的核心能力：
1. 基于上述画像精准推荐歌曲（具体到歌名+艺人）
2. 陪用户聊音乐、歌手、专辑、流派、音乐文化
3. 分析用户的品味，主动给出洞察（"我注意到你最近常听XXX，可能也会喜欢YYY"）
4. 帮用户发现新音乐，但不偏离已知偏好太远

交流风格：
- 像一位真正懂用户的老友：自然、有品味、不啰嗦
- 主动引用画像中的具体偏好（比如"你之前提过喜欢XXX"），让用户感到被记住
- 推荐歌曲时给出具体歌名+艺人+一句推荐理由
- 控制在 150 字以内，避免长篇大论
- 不要假装记住没在画像里的事
- **纯文本输出**：禁止任何 Markdown 标记（不要用 **粗体**、*斜体*、# 标题、列表符号 - 等），歌名用《》包裹即可
- **严禁舞台指令、括号注解、动作描写**：不要写"(指尖在触控板上轻轻一敲)"、"(背景音乐里...)"、"(深夜的时候...)"等任何带括号的旁白/场景描写。也不要写"*微笑*"、"*点头*"等动作。直接说话，像在用文字对话。
- **禁止虚构未发生的动作**：不要说"我已经把XXX加到队列了"、"我帮你切到XXX了"等。前端会根据 ACTION 指令自动执行，你只需要给建议+ACTION 协议块。
- **歌名艺人必须配对清晰**：每提到一首歌都要紧跟艺人名，如"《晚风1997》(蓝兰)"或"蓝兰的《晚风1997》"，方便前端识别成可点击。

【重要：可执行指令协议】
如果用户意图是"我要听XXX"、"切回原版"、"播放XXX"、"推荐给我听"等可执行的操作，你**必须**在回复末尾单独一行追加指令块（用户不会看到原始指令块，前端会渲染成按钮）：
格式：[ACTION:play|song=歌名|artist=艺人名]  表示"建议用户播放这首歌"
     [ACTION:recommend|prompt=心情或风格描述]  表示"建议重新生成一组推荐"
     [ACTION:open_panel|panel=favorites|history|playlist|search]  表示"建议打开某个面板"
举例：
用户："切回原版"
你：好，这就切回蓝兰的原版。那个前奏比 DJ 版更慢，情绪更稳。\n[ACTION:play|song=晚风1997|artist=蓝兰]

每条回复可包含 0-3 个 ACTION 指令（多首推荐时每首一个 play）。没有合适的可执行操作就不加。不要解释 ACTION 机制。

【兜底】即使你忘记加 ACTION，前端也会自动识别消息中的"《歌名》艺人名"组合，渲染为可点击的播放按钮。所以歌名艺人**必须配对清晰**：每提到一首歌都要紧跟艺人，便于识别。`;

    const completion = await createCompletion('chat', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.85,
      max_tokens: 600,
    });

    let reply = completion.choices[0]?.message?.content?.trim() || '';
    // 兜底清洗：strip 掉舞台指令/动作描写括号（不影响 ACTION 协议块和《》歌名）
    // 仅匹配整段独占的圆括号注解（中英文括号），跳过 [ACTION:...] 方括号
    reply = reply
      .replace(/^[（(][^（()）]*[）)]\s*$/gm, '')         // 单独成行的括号
      .replace(/\s*[（(][^（()）]{0,80}[）)](?=\s|$)/g, '') // 行内括号注解
      .replace(/\n{3,}/g, '\n\n')                          // 折叠多余空行
      .trim();
    res.json({ reply, memoryUsed: memory.length });
  } catch (err: any) {
    console.error('[ai/chat]', err);
    res.status(500).json({ error: err.message || 'AI 对话失败' });
  }
});

// ============================================================
// 从对话提取结构化记忆（升级版）
// ============================================================
router.post('/extract-memory', async (req, res) => {
  try {
    const { conversation } = req.body;
    if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
      return res.status(400).json({ error: '缺少 conversation 参数' });
    }

    const prompt = `请从以下对话中提取用户的音乐偏好信息。每条记忆必须分类，最多提取 5 条。

分类（category）：
- artist: 喜欢/不喜欢的艺人（tag = 艺人名）
- genre: 流派/风格偏好（tag = 流派名，如"灵魂乐"、"民谣"、"R&B"）
- mood: 情绪偏好（tag = 情绪标签，如"治愈"、"燃"、"怀旧"）
- scene: 使用场景（tag = 场景，如"通勤"、"睡前"、"工作"）
- song: 具体歌曲偏好（tag = 歌名）
- dislike: 明确不喜欢的（极性=negative，tag = 对象名）
- fact: 其他重要事实

极性（polarity）：positive 或 negative
content：**禁止以"用户"开头**！直接写偏好主体，不超过 20 字。
  - 好例子：「喜欢周传雄」「偏爱民谣」「睡前场景」「不喜欢电音」
  - 坏例子：「用户喜欢周传雄」「用户偏爱民谣」
tag：关键标签（用于聚合同类记忆，必填，简洁到艺人名/流派名/情绪名）

只输出 JSON 数组，不要其他文字：
[
  { "category": "artist", "tag": "周传雄", "polarity": "positive", "content": "喜欢周传雄" },
  { "category": "genre", "tag": "民谣", "polarity": "positive", "content": "偏爱民谣" }
]

如果对话中没有明确的偏好信号，输出空数组 []。

对话：
${conversation.slice(-6).map((m: any) => `${m.role}: ${m.content}`).join('\n')}`;

    const completion = await createCompletion('extract', {
      messages: [
        { role: 'system', content: '你是一位结构化偏好提取助手。严格按格式输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '';
    let entries: any[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      entries = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch { /* ignore */ }

    // 校验：必须有 category + content
    const validEntries = entries.filter((e: any) =>
      e && typeof e.content === 'string' && e.content.length > 0 &&
      ['artist', 'genre', 'mood', 'scene', 'song', 'dislike', 'fact'].includes(e.category)
    );

    const visitorId = getVisitorId(req);
    const memory = readMemory(visitorId);
    const merged = mergeMemory(memory, validEntries);
    writeMemory(visitorId, merged);

    res.json({ entries: validEntries, count: merged.length });
  } catch (err: any) {
    console.error('[ai/extract-memory]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 行为信号上报（前端在用户播放/跳过/收藏/不喜欢时调用）
// ============================================================
router.post('/feedback', (req, res) => {
  try {
    const { action, song } = req.body;
    if (!action || !song?.name || !song?.artist) {
      return res.status(400).json({ error: '需要 action 和 song' });
    }
    const visitorId = getVisitorId(req);
    const memory = readMemory(visitorId);

    const entries: Partial<MemoryEntry>[] = [];
    if (action === 'favorite') {
      entries.push({ category: 'artist', tag: song.artist, polarity: 'positive', content: `喜欢${song.artist}` });
      entries.push({ category: 'song', tag: song.name, polarity: 'positive', content: `收藏《${song.name}》` });
    } else if (action === 'unfavorite') {
      entries.push({ category: 'song', tag: song.name, polarity: 'negative', content: `取消收藏《${song.name}》` });
    } else if (action === 'skip') {
      entries.push({ category: 'song', tag: song.name, polarity: 'negative', content: `跳过《${song.name}》` });
    } else if (action === 'play_complete') {
      entries.push({ category: 'artist', tag: song.artist, polarity: 'positive', content: `常听${song.artist}` });
    } else if (action === 'dislike') {
      entries.push({ category: 'dislike', tag: song.artist, polarity: 'negative', content: `不喜欢${song.artist}` });
    }

    if (entries.length === 0) return res.json({ success: true, skipped: true });

    const merged = mergeMemory(memory, entries);
    writeMemory(visitorId, merged);
    res.json({ success: true, count: merged.length });
  } catch (err: any) {
    console.error('[ai/feedback]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
