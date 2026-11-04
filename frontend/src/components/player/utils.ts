import type { Song } from '../../types';

// 金色强调色
export const GOLD = '#C9A96E';

// 格式化播放时间 mm:ss
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 格式化时长 mm:ss（歌曲列表用）
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 解析 LRC 歌词（过滤元信息）
export function parseLyric(lrc: string): { time: number; text: string }[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: { time: number; text: string }[] = [];
  const timeRe = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  // 过滤 LRC 元信息文本（作曲、作词、编曲等）
  const metaRe = /^(作曲|作词|编曲|制作|混音|母带|录音|和声|吉他|钢琴|贝斯|鼓|弦乐|监制|出品|发行|OP|SP|词|曲|编|唱片|原唱|翻唱|Arranger|Composer|Lyricist|Producer|Mixing|Mastering)\s*[：:]/i;
  for (const line of lines) {
    const m = line.match(timeRe);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = parseInt(m[3].padEnd(3, '0'), 10);
      const text = m[4].trim();
      // 跳过元信息行和空行
      if (!text || metaRe.test(text)) continue;
      result.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

// 把翻译歌词（tlyric）按时间戳对齐到主歌词行，供双语渲染
export function mergeLyricTranslation(tlrc: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!tlrc) return map;
  for (const line of parseLyric(tlrc)) {
    // 时间戳可能有几十毫秒偏差，按 0.5s 容差匹配最近的主歌词行
    map.set(Math.round(line.time * 2) / 2, line.text);
  }
  return map;
}

/** 取某行歌词对应的译文（容差匹配） */
export function findTranslation(map: Map<number, string>, time: number): string | null {
  const direct = map.get(Math.round(time * 2) / 2);
  if (direct) return direct;
  for (const delta of [0.5, -0.5, 1, -1]) {
    const hit = map.get(Math.round((time + delta) * 2) / 2);
    if (hit) return hit;
  }
  return null;
}

// 歌名 / 艺人归一化相似度（0~1），用于抑制 LLM 幻觉与同名不同艺人的错配
export function similarityScore(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase()
    .replace(/[\s·・\-_（）()【】\[\]《》'"”,，.。!！?？]/g, '')
    .replace(/official|歌词版|mv|hd|高清|原版|完整版/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // 字符 bigram 的 Jaccard 相似度，对中文替换/多字差异敏感
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const gx = grams(x); const gy = grams(y);
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter++;
  return inter / Math.max(1, gx.size + gy.size - inter);
}

// 排序：正式发行版优先 → 免费优先 → 国内优先
export function sortSongsByPriority(songs: Song[]): Song[] {
  return [...songs].sort((a, b) => {
    // 1) 正式发行版优先（无括号后缀 > 有括号但非live/dj > live/dj/综艺版）
    const aOfficial = getOfficialScore(a);
    const bOfficial = getOfficialScore(b);
    if (aOfficial !== bOfficial) return aOfficial - bOfficial;
    // 2) 免费优先
    const aFree = a.fee !== 1 ? 0 : 1;
    const bFree = b.fee !== 1 ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;
    // 3) 国内平台优先
    const prio: Record<string, number> = { netease: 0, qq: 1, youtube: 2 };
    return (prio[a.platform || 'netease'] || 2) - (prio[b.platform || 'netease'] || 2);
  });
}

// 判断是否为纯音乐/伴奏/Live/Remix/DJ/综艺 等不想要的版本
// 这是兜底过滤层：即使 LLM 推荐了"纯音乐版"，搜索结果命中带这些关键词的歌曲也直接丢弃
const INSTRUMENTAL_PATTERNS = [
  // 纯音乐/伴奏
  /纯音乐/i, /纯钢琴/i, /钢琴版/i, /钢琴曲/i, /演奏版/i, /演奏曲/i,
  /伴奏/i, /\binstrumental\b/i, /\binst\b/i, /\bkaraoke\b/i, /\bbgm\b/i,
  /白噪音/i, /\basmr\b/i, /\bambient\b/i, /\blofi\b/i, /lo-?fi/i,
  /冥想音乐/i, /助眠/i, /轻音乐/i, /\bost\b.*纯音乐/i,
  // Live/演唱会/现场版等各种非正式发行变体
  /live版/i, /\(live\)/i, /\blive\b/i, /演唱会/i, /演唱會/i,
  /现场版/i, /現場版/i, /现场录音/i, /\bconcert\b/i,
  /音乐节/i, /跨年晚会/i, /跨年演唱会/i, /春晚/i,
  // Remix/DJ 版
  /remix/i, /混音/i, /\bdj版/i, /\(dj\s/i, /dj\s+\w+版/i, /the.*remix/i,
  // 综艺/节目版本（CCTV、浙江卫视等）
  /cctv/i, /卫视/i, /综艺/i, /音乐频道/i, /好声音/i, /歌手\d/i,
  /我是歌手/i, /中国好声音/i, /蒙面唱将/i, /天赐的声音/i,
  /跑吧/i, /快乐大本营/i, /王牌对王牌/i,
  // 翻唱/Cover
  /翻唱/i, /翻自/i, /cover版/i, /\(cover\)/i,
  // 其他非正式版本
  /片段/i, /彩排/i, /排练/i, /demo版/i, /\bdemo\b/i, /试听版/i,
  /铃声版/i, /手机铃声/i, /短视频版/i, /抖音版/i, /快手版/i,
  /3d环绕/i, /8d环绕/i, /双声道/i,
];

export function isInstrumentalOrUnwanted(song: Song): boolean {
  const haystack = `${song.name || ''} ${(song as any).album || ''}`.toLowerCase();
  return INSTRUMENTAL_PATTERNS.some((re) => re.test(haystack));
}

// 计算歌曲的"正式发行版"优先级分数（越低越优先）
// 用于搜索结果排序：正式版在前，Live/DJ/综艺版在后
export function getOfficialScore(song: Song): number {
  const name = (song.name || '').toLowerCase();
  // 完全匹配（无括号后缀）最优
  if (!/[（(]/.test(name)) return 0;
  // 有括号但不是不想要的版本
  if (!isInstrumentalOrUnwanted(song)) return 1;
  // 是不想要的版本
  return 10;
}

// 过滤掉纯音乐/伴奏/Live/Remix
export function filterOutInstrumental(songs: Song[]): Song[] {
  return songs.filter((s) => !isInstrumentalOrUnwanted(s));
}

// 从候选中选择最优歌曲（正式版优先 → 免费 → 国内优先，自动过滤纯音乐/伴奏/Live）
// 支持传入 AI 输出的期望歌名/艺人，低于相似度阈值的候选直接丢弃，避免「张冠李戴」
export function pickBestCandidate(candidates: Song[], expected?: { name: string; artist?: string }): Song | undefined {
  const filtered = filterOutInstrumental(candidates);
  if (filtered.length === 0) return undefined;

  let pool = filtered;
  if (expected?.name) {
    const scored = filtered
      .map((song) => {
        const nameScore = similarityScore(expected.name, song.name);
        const artistScore = expected.artist ? similarityScore(expected.artist, song.artist) : 1;
        return { song, score: nameScore * 0.7 + artistScore * 0.3 };
      })
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score);
    // 全部低于阈值时宁可跳过，也不播放错歌
    if (scored.length === 0) return undefined;
    pool = scored.map((x) => x.song);
  }
  return sortSongsByPriority(pool)[0];
}

// 清理歌名中的 (Live)/(DJ xxx)/(xxx版) 等后缀，用于搜索时去掉干扰词
export function cleanSongName(name: string): string {
  return name
    .replace(/\s*[\(（][^)）]*(?:live|dj|remix|cover|现场|演唱会|concert|综艺|cctv|卫视|demo|铃声|短视频|抖音)[^)）]*[\)）]/gi, '')
    .replace(/\s*-\s*(?:live|dj|remix|现场版|演唱会版)$/i, '')
    .trim();
}
