import { Router } from 'express';
import * as NeteaseAPI from 'NeteaseCloudMusicApi';
import { execFile, execSync } from 'child_process';
import fs from 'fs';
import { DEFAULT_PUBLIC_SOURCE_KEY } from '../config/compat';

const router = Router();

// 可选公开音源标识：每次请求时读取，保证设置面板修改后即时生效。
function getPublicSourceKey(): string {
  return process.env.YTMUSIC_API_KEY || DEFAULT_PUBLIC_SOURCE_KEY;
}

// YouTube URL 内存缓存（URL 通常有效 4-6 小时，我们缓存 2 小时）
const ytUrlCache = new Map<string, { url: string; expires: number }>();
const YT_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 小时

function getCachedYtUrl(videoId: string): string | null {
  const entry = ytUrlCache.get(videoId);
  if (entry && entry.expires > Date.now()) return entry.url;
  if (entry) ytUrlCache.delete(videoId);
  return null;
}

function setCachedYtUrl(videoId: string, url: string) {
  ytUrlCache.set(videoId, { url, expires: Date.now() + YT_CACHE_TTL });
  if (ytUrlCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of ytUrlCache) {
      if (v.expires < now) ytUrlCache.delete(k);
    }
  }
}

// 跨平台查找 yt-dlp 路径
function findYtdlp(): string {
  // 1. 尝试 which/where 查找
  try {
    const cmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
    const found = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
    if (found && fs.existsSync(found)) return found;
  } catch { /* ignore */ }

  // 2. 常见路径候选
  const candidates = process.platform === 'win32'
    ? ['C:\\yt-dlp\\yt-dlp.exe', 'C:\\Users\\' + (process.env.USERNAME || '') + '\\yt-dlp\\yt-dlp.exe']
    : ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'yt-dlp'; // 回退：依赖 PATH
}

const ytdlpPath = findYtdlp();
console.log('[music] yt-dlp path:', ytdlpPath);

// 构建完整 PATH（Electron 子进程 PATH 受限，yt-dlp n challenge 需要 node）
const fullPath = [
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
  process.env.HOME + '/.nvm/current/bin',
  process.env.PATH || '',
].join(':');

// 异步调用 yt-dlp
function getYtdlpUrl(videoId: string, forceRefresh = false): Promise<string> {
  return new Promise((resolve) => {
    if (!forceRefresh) {
      const cached = getCachedYtUrl(videoId);
      if (cached) { resolve(cached); return; }
    }
    const videoUrl = `https://music.youtube.com/watch?v=${videoId}`;
    execFile(ytdlpPath, ['-f', 'bestaudio', '--get-url', '--cookies-from-browser', 'chrome', videoUrl], {
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: fullPath },
    }, (err, stdout) => {
      if (err) { console.error('[yt-dlp]', err.message?.slice(0, 300)); resolve(''); return; }
      const url = (stdout || '').trim();
      if (url && url.startsWith('http')) { setCachedYtUrl(videoId, url); resolve(url); }
      else resolve('');
    });
  });
}

// ========== 网易云音乐（现有逻辑，完全保留）==========

// 搜索歌曲
router.get('/search', async (req, res) => {
  try {
    const { keywords, limit = '20', offset = '0' } = req.query;
    if (!keywords) {
      return res.status(400).json({ error: '缺少 keywords 参数' });
    }

    const result = await (NeteaseAPI as any).search({
      keywords: String(keywords),
      limit: Number(limit),
      offset: Number(offset),
      type: 1,
    });

    const songs = result.body.result?.songs?.map((s: any) => ({
      id: s.id,
      name: s.name,
      artist: s.artists?.map((a: any) => a.name).join(', ') || '未知艺人',
      album: s.album?.name || '未知专辑',
      cover: (s.album?.picUrl || '').replace('http://', 'https://'),
      duration: Math.floor((s.duration || s.dt || 0) / 1000),
      fee: s.fee ?? 0,
    })) || [];

    res.json({ songs, total: result.body.result?.songCount || 0 });
  } catch (err: any) {
    console.error('[music/search]', err);
    res.status(500).json({ error: err.message || '搜索失败' });
  }
});

// 获取歌曲 URL
router.get('/url', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: '缺少 id 参数' });
    }

    const result = await (NeteaseAPI as any).song_url({
      id: Number(id),
      br: 320000,
    });

    const url = result.body.data?.[0]?.url || '';
    res.json({ id: Number(id), url });
  } catch (err: any) {
    console.error('[music/url]', err);
    res.status(500).json({ error: err.message || '获取URL失败' });
  }
});

// 获取歌词
router.get('/lyric', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: '缺少 id 参数' });
    }

    const result = await (NeteaseAPI as any).lyric({
      id: Number(id),
    });

    res.json({
      id: Number(id),
      lyric: result.body.lrc?.lyric || '',
      tlyric: result.body.tlyric?.lyric || '',
    });
  } catch (err: any) {
    console.error('[music/lyric]', err);
    res.status(500).json({ error: err.message || '获取歌词失败' });
  }
});

// 根据歌名+歌手搜索网易云匹配歌曲并返回歌词（用于 YouTube/QQ 等非网易云歌曲）
router.get('/lyric-by-name', async (req, res) => {
  try {
    const { name, artist } = req.query;
    if (!name) {
      return res.status(400).json({ error: '缺少 name 参数' });
    }

    const keywords = `${String(name)} ${String(artist || '')}`.trim();
    const searchResult = await (NeteaseAPI as any).search({
      keywords,
      limit: 5,
      offset: 0,
      type: 1,
    });

    const songs = searchResult.body.result?.songs || [];
    if (songs.length === 0) {
      return res.json({ lyric: '', tlyric: '', matched: false });
    }

    // 只有歌名/艺人确实对得上才返回歌词，宁可「暂无歌词」也不显示错歌的歌词
    const normalize = (s: string) => String(s || '').toLowerCase()
      .replace(/[\s·・\-_（）()【】\[\]《》'"”,，.。!！?？]/g, '')
      .replace(/official|lyrics?|mv|hd|高清|原版|完整版|伴奏/g, '');
    const targetName = normalize(String(name));
    const targetArtist = normalize(String(artist || ''));

    const best = songs.map((s: any) => {
      const candidateName = normalize(s.name || '');
      const candidateArtist = normalize((s.artists || []).map((a: any) => a.name).join(',') || '');
      const nameMatch = candidateName === targetName
        || (targetName.length >= 3 && (candidateName.includes(targetName) || targetName.includes(candidateName)));
      const artistMatch = !targetArtist || !candidateArtist
        || candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist);
      return { song: s, score: (nameMatch ? 1 : 0) + (artistMatch ? 1 : 0) };
    }).sort((a: { score: number }, b: { score: number }) => b.score - a.score)[0];

    // 歌名必须匹配；艺人不一致时至少要求歌名完全一致
    if (!best || best.score < 2) {
      return res.json({ lyric: '', tlyric: '', matched: false, reason: 'no_confident_match' });
    }

    const matchedId = best.song.id;
    const lyricResult = await (NeteaseAPI as any).lyric({ id: matchedId });

    res.json({
      id: matchedId,
      lyric: lyricResult.body.lrc?.lyric || '',
      tlyric: lyricResult.body.tlyric?.lyric || '',
      matched: true,
      matchedName: best.song.name,
      matchedArtist: (best.song.artists || []).map((a: any) => a.name).join(', ') || '',
    });
  } catch (err: any) {
    console.error('[music/lyric-by-name]', err);
    res.status(500).json({ error: err.message || '搜索歌词失败' });
  }
});

// 获取歌曲详情（批量）
router.get('/detail', async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ error: '缺少 ids 参数' });
    }

    const result = await (NeteaseAPI as any).song_detail({
      ids: String(ids),
    });

    const songs = result.body.songs?.map((s: any) => ({
      id: s.id,
      name: s.name,
      artist: s.ar?.map((a: any) => a.name).join(', ') || '未知艺人',
      album: s.al?.name || '未知专辑',
      cover: (s.al?.picUrl || '').replace('http://', 'https://'),
      duration: Math.floor((s.dt || 0) / 1000),
      fee: s.fee ?? 0,
    })) || [];

    res.json({ songs });
  } catch (err: any) {
    console.error('[music/detail]', err);
    res.status(500).json({ error: err.message || '获取详情失败' });
  }
});

// ========== 多平台聚合搜索（新增）==========

// 统一的歌曲数据结构
interface UnifiedSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  platform: 'netease' | 'qq' | 'youtube';
  platformName: string;
  fee: number; // 0=免费, 1=VIP/试听, 2=付费
  url?: string;
  playable: boolean;
}

// QQ 音乐搜索（直接调用 Web CGI，不依赖有 Bug 的 qq-music-api npm 库）
async function searchQQMusic(keyword: string, limit: number): Promise<UnifiedSong[]> {
  try {
    const params = JSON.stringify({
      search: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          search_type: 0,
          query: keyword,
          page_num: 1,
          num_per_page: limit,
        },
      },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(params)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) {
      console.error('[searchQQMusic] HTTP', res.status);
      return [];
    }
    const data = await res.json() as any;
    const songs = data?.search?.data?.body?.song?.list || [];
    return songs.slice(0, limit).map((s: any) => ({
      id: String(s.mid || s.id),
      name: s.title || '未知歌曲',
      artist: (s.singer || []).map((a: any) => a.name).join(', ') || '未知艺人',
      album: s.album?.name || '未知专辑',
      cover: s.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
      duration: s.interval || 0,
      platform: 'qq' as const,
      platformName: 'QQ音乐',
      fee: s.pay?.pay_play === 1 ? 1 : 0,
      playable: s.pay?.pay_play !== 1,
    }));
  } catch (err: any) {
    console.error('[searchQQMusic]', err.message);
    return [];
  }
}

// YouTube Music 搜索（使用 YouTube Music 内部 API，国内可达）
async function searchYouTubeMusic(keyword: string, limit: number): Promise<UnifiedSong[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://music.youtube.com/youtubei/v1/search?key=${encodeURIComponent(getPublicSourceKey())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20231016.01.00' } },
          query: keyword,
          params: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D', // 筛选：歌曲
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) {
      console.error('[searchYouTubeMusic] HTTP', res.status);
      return [];
    }
    const data = await res.json() as any;

    // 递归查找 musicShelfRenderer
    function findKey(obj: any, key: string, depth = 0): any[] {
      if (depth > 15) return [];
      const results: any[] = [];
      if (obj && typeof obj === 'object') {
        if (key in obj) results.push(obj[key]);
        for (const v of Object.values(obj)) results.push(...findKey(v, key, depth + 1));
      }
      if (Array.isArray(obj)) {
        for (const item of obj) results.push(...findKey(item, key, depth + 1));
      }
      return results;
    }

    const shelves = findKey(data, 'musicShelfRenderer');
    if (!shelves.length) return [];

    const contents = shelves[0].contents || [];
    const songs: UnifiedSong[] = [];

    for (const item of contents.slice(0, limit)) {
      try {
        const r = item.musicResponsiveListItemRenderer;
        if (!r) continue;
        const cols = r.flexColumns || [];
        // 标题
        const titleRuns = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const title = titleRuns[0]?.text || '';
        // 艺人（col1 的第一个 run）
        const infoRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artist = infoRuns[0]?.text || '未知艺人';
        // 时长（info 的最后一个文本，格式 "3:43"）
        const infoTexts = infoRuns.filter((x: any) => x.text?.trim() && !['•', ' • '].includes(x.text.trim())).map((x: any) => x.text);
        const durStr = infoTexts[infoTexts.length - 1] || '';
        const durParts = durStr.split(':').map(Number);
        const duration = durParts.length === 2 ? (durParts[0] || 0) * 60 + (durParts[1] || 0) : 0;
        // videoId
        const overlay = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer || {};
        const videoId = overlay.playNavigationEndpoint?.watchEndpoint?.videoId || '';
        // 封面
        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const cover = thumbs.length ? thumbs[thumbs.length - 1].url : '';

        if (title && videoId) {
          songs.push({
            id: videoId,
            name: title,
            artist,
            album: '',
            cover,
            duration,
            platform: 'youtube',
            platformName: 'YouTube',
            fee: 0,
            playable: true,
          });
        }
      } catch { continue; }
    }
    return songs;
  } catch (err: any) {
    console.error('[searchYouTubeMusic]', err.message);
    return [];
  }
}

// 多平台聚合搜索
router.get('/multi-search', async (req, res) => {
  try {
    const { keywords, platforms = 'netease,qq,youtube', limit = '15' } = req.query;
    if (!keywords) {
      return res.status(400).json({ error: '缺少 keywords 参数' });
    }

    const platformList = String(platforms).split(',').map((p) => p.trim());
    // 每个平台都拿 limit 条（不再平分），确保各平台充分展示
    const searchLimit = Number(limit);
    const results: Record<string, UnifiedSong[]> = {};
    // 音源状态：让前端能区分「没这首歌」与「某个平台挂了」
    const sourceStatus: Record<string, 'ok' | 'degraded' | 'down' | 'unconfigured'> = {};
    for (const p of platformList) {
      sourceStatus[p] = p === 'youtube' && !getPublicSourceKey() ? 'unconfigured' : 'ok';
    }

    // 并行搜索各平台
    const promises: Promise<void>[] = [];

    if (platformList.includes('netease')) {
      promises.push(
        (async () => {
          try {
            const neteaseResult = await (NeteaseAPI as any).search({
              keywords: String(keywords),
              limit: searchLimit,
              offset: 0,
              type: 1,
            });
            const songs = neteaseResult.body.result?.songs?.map((s: any) => ({
              id: String(s.id),
              name: s.name,
              artist: s.artists?.map((a: any) => a.name).join(', ') || '未知艺人',
              album: s.album?.name || '未知专辑',
              cover: (s.album?.picUrl || '').replace('http://', 'https://'),
              duration: Math.floor((s.duration || s.dt || 0) / 1000),
              platform: 'netease' as const,
              platformName: '网易云',
              fee: s.fee ?? 0,
              playable: s.fee !== 1,
            })) || [];
            // 批量补充封面（search 接口经常不返回 picUrl）
            if (songs.length > 0) {
              try {
                const ids = songs.map((s: any) => s.id).join(',');
                const detailResult = await (NeteaseAPI as any).song_detail({ ids });
                const detailSongs = detailResult.body.songs || [];
                for (const ds of detailSongs) {
                  const target = songs.find((s: any) => String(s.id) === String(ds.id));
                  if (target && !target.cover && ds.al?.picUrl) {
                    target.cover = ds.al.picUrl.replace('http://', 'https://');
                  }
                }
              } catch { /* ignore cover fetch failure */ }
            }
            results['netease'] = songs;
            sourceStatus['netease'] = songs.length > 0 ? 'ok' : 'degraded';
          } catch (err: any) {
            console.error('[multi-search/netease]', err.message);
            results['netease'] = [];
            sourceStatus['netease'] = 'down';
          }
        })()
      );
    }

    if (platformList.includes('qq')) {
      promises.push(
        (async () => {
          try {
            results['qq'] = await searchQQMusic(String(keywords), searchLimit);
            sourceStatus['qq'] = results['qq'].length > 0 ? 'ok' : 'degraded';
          } catch (err: any) {
            console.error('[multi-search/qq]', err.message);
            results['qq'] = [];
            sourceStatus['qq'] = 'down';
          }
        })()
      );
    }

    if (platformList.includes('youtube')) {
      promises.push(
        (async () => {
          if (!getPublicSourceKey()) { results['youtube'] = []; return; }
          try {
            results['youtube'] = await searchYouTubeMusic(String(keywords), searchLimit);
            sourceStatus['youtube'] = results['youtube'].length > 0 ? 'ok' : 'degraded';
          } catch (err: any) {
            console.error('[multi-search/youtube]', err.message);
            results['youtube'] = [];
            sourceStatus['youtube'] = 'down';
          }
        })()
      );
    }

    await Promise.all(promises);

    res.json({
      keyword: keywords,
      platforms: platformList,
      results,
      sourceStatus,
    });
  } catch (err: any) {
    console.error('[music/multi-search]', err);
    res.status(500).json({ error: err.message || '聚合搜索失败' });
  }
});

// 获取多平台歌曲播放 URL
router.get('/multi-url', async (req, res) => {
  try {
    const { platform, id, refresh } = req.query;
    if (!platform || !id) {
      return res.status(400).json({ error: '缺少 platform 或 id 参数' });
    }
    // refresh=1：URL 过期时强制绕过 YouTube 缓存重新取链
    const forceRefresh = refresh === '1' || refresh === 'true';

    let url = '';
    let expiresAt: number | null = null;

    if (platform === 'netease') {
      const result = await (NeteaseAPI as any).song_url({
        id: Number(id),
        br: 320000,
      });
      url = result.body.data?.[0]?.url || '';
    } else if (platform === 'qq') {
      // QQ 音乐播放 URL（通过 Web CGI）
      try {
        const qqParams = JSON.stringify({
          req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
              guid: '0',
              songmid: [String(id)],
              songtype: [0],
              uin: '0',
              loginflag: 0,
              platform: '20',
            },
          },
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const qqRes = await fetch(
          `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(qqParams)}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (qqRes.ok) {
          const qqData = await qqRes.json() as any;
          const midurlinfo = qqData?.req_0?.data?.midurlinfo || [];
          const sip = qqData?.req_0?.data?.sip || [];
          if (midurlinfo[0]?.purl && sip[0]) {
            url = sip[0] + midurlinfo[0].purl;
          }
        }
      } catch (err: any) {
        console.error('[multi-url/qq]', err.message);
      }
      // 不再返回缺少 vkey 的兜底试听 URL（必然 403，会让前端连续跳过 3 首）
      // 返回空 url，由前端走「换源 / 重试」流程
    } else if (platform === 'youtube') {
      // YouTube 使用 yt-dlp 获取音频流 URL（异步 + 缓存）
      url = await getYtdlpUrl(String(id), forceRefresh);
      if (url) expiresAt = Date.now() + YT_CACHE_TTL;
    }

    res.json({ platform, id: String(id), url, expiresAt });
  } catch (err: any) {
    console.error('[music/multi-url]', err);
    res.status(500).json({ error: err.message || '获取URL失败' });
  }
});

export default router;
