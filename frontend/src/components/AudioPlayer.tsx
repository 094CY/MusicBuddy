import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { apiFetch } from '../config';
import type { Song, SongAlternative } from '../types';

const FADE_DURATION = 300;
const MAX_SKIP = 3;

/**
 * play() 可能被浏览器自动播放策略拒绝，或因切歌 / 卸载被打断。
 * 这类失败不阻断主流程，但必须留下可排查的原因，不得静默吞掉。
 */
function playSafely(audio: HTMLAudioElement, reason: string): void {
  audio.play().catch((err: unknown) => {
    console.warn(`[AudioPlayer] play 未生效（${reason}）`, err);
  });
}


/** 歌曲身份：平台 + id + 歌名 + 艺人，用于歌词等衍生数据的竞态判断 */
function currentSongKey(song: Song | null): string {
  return song ? `${song.platform || 'netease'}|${song.id}|${song.name}|${song.artist}` : '';
}

type Platform = 'netease' | 'qq' | 'youtube';

/** 取某个音源的播放链接；refresh=1 用于 URL 过期时强制绕过缓存 */
async function fetchSourceUrl(platform: Platform, id: string | number, refresh = false): Promise<string> {
  const query = refresh ? '&refresh=1' : '';
  if (platform === 'netease') {
    const res = await apiFetch(`/api/music/url?id=${encodeURIComponent(String(id))}${query}`, { timeoutMs: 15000 });
    const data = await res.json();
    return data.url || '';
  }
  const res = await apiFetch(`/api/music/multi-url?platform=${platform}&id=${encodeURIComponent(String(id))}${query}`, { timeoutMs: 35000 });
  const data = await res.json();
  return data.url || '';
}

/** 按「当前源 → 其他平台备源」构造尝试序列，且同一个源只试一次 */
function buildSourceChain(song: Song): { platform: Platform; id: string | number }[] {
  const current = (song.platform || 'netease') as Platform;
  const chain: { platform: Platform; id: string | number }[] = [{ platform: current, id: song.id }];
  const seen = new Set<string>([`${current}:${song.id}`]);
  for (const alt of (song.alternatives || []) as SongAlternative[]) {
    const key = `${alt.platform}:${alt.id}`;
    if (!seen.has(key)) { seen.add(key); chain.push({ platform: alt.platform, id: alt.id }); }
  }
  // 电台 / AI 推荐结果未携带备源时，仍尝试按歌名在其余平台找同曲（由后端搜索兜底）
  return chain;
}

export default function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const lastLoadedSongKey = useRef('');
  const skipRetryRef = useRef(0);
  // 切歌时用于取消上一轮异步取链，避免过期响应写回
  const loadTokenRef = useRef(0);

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const playMode = usePlayerStore((s) => s.playMode);
  const retryToken = usePlayerStore((s) => s.playbackRetryToken);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrev = usePlayerStore((s) => s.playPrev);
  const setBuffering = usePlayerStore((s) => s.setBuffering);
  const setPlaybackError = usePlayerStore((s) => s.setPlaybackError);

  const fadeIn = (audio: HTMLAudioElement, targetVol: number) => {
    if (fadeTimerRef.current) cancelAnimationFrame(fadeTimerRef.current);
    audio.volume = 0;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / FADE_DURATION, 1);
      audio.volume = targetVol * progress;
      if (progress < 1) fadeTimerRef.current = requestAnimationFrame(animate);
    };
    fadeTimerRef.current = requestAnimationFrame(animate);
  };

  // 加载歌曲 URL（切歌 / 手动重试时触发）
  useEffect(() => {
    if (!currentSong?.id) return;

    const token = ++loadTokenRef.current;
    const songKey = `${currentSong.id}_${currentSong.platform || 'netease'}_${retryToken}`;
    if (lastLoadedSongKey.current === songKey) {
      if (audioRef.current && audioRef.current.src) {
        audioRef.current.currentTime = 0;
        if (usePlayerStore.getState().isPlaying) playSafely(audioRef.current, '重复选中当前歌曲');
      }
      return;
    }

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      } catch (err) {
        // 旧音频元素可能已卸载或 src 已清空；清理失败不影响后续加载
        console.warn('[AudioPlayer] 清理旧音频资源失败，可忽略', err);
      }
    }

    const applyUrl = async (url: string) => {
      const audio = audioRef.current;
      if (!audio || token !== loadTokenRef.current) return;
      lastLoadedSongKey.current = songKey;
      audio.src = url;
      audio.load();
      const latest = usePlayerStore.getState();
      if (latest.isPlaying) {
        try {
          await audio.play();
          fadeIn(audio, latest.volume);
        } catch (err) {
          console.warn('[AudioPlayer] play() 失败', err);
        }
      }
    };

    const loadUrl = async () => {
      const chain = buildSourceChain(currentSong);
      setPlaybackError(null);
      setBuffering(true);
      try {
        // 阶段 1：按音源链依次取链；首选源额外做一次强制刷新重试
        for (let i = 0; i < chain.length; i++) {
          const source = chain[i];
          let url = '';
          try {
            url = await fetchSourceUrl(source.platform, source.id, false);
            if (!url && i === 0) url = await fetchSourceUrl(source.platform, source.id, true);
          } catch { /* 该源失败，继续下一个 */ }
          if (token !== loadTokenRef.current) return;
          if (url) {
            skipRetryRef.current = 0;
            await applyUrl(url);
            return;
          }
        }

        // 阶段 2：全部音源都拿不到链接 → 展示可见错误态，不再静默跳歌
        console.warn('[AudioPlayer] 所有音源均不可用', currentSong.name);
        setPlaybackError({ songName: currentSong.name, message: '这首歌暂时无法获取播放链接' });
        setBuffering(false);
        setIsPlaying(false);
        skipRetryRef.current += 1;
        // 电台等无人值守场景仍自动续流，但限制连续跳过次数
        if (skipRetryRef.current < MAX_SKIP) {
          setTimeout(() => {
            if (token === loadTokenRef.current) usePlayerStore.getState().playNext();
          }, 1200);
        }
      } catch (e) {
        console.error('[AudioPlayer] 加载歌曲失败', e);
        if (token !== loadTokenRef.current) return;
        setBuffering(false);
        setPlaybackError({ songName: currentSong.name, message: '网络异常，播放链接获取失败' });
        setIsPlaying(false);
      } finally {
        if (token === loadTokenRef.current) setBuffering(false);
      }
    };

    loadUrl();
  }, [currentSong?.id, currentSong?.platform, retryToken, setIsPlaying, setBuffering, setPlaybackError]);

  // 播放/暂停
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (isPlaying) {
      audio.play().catch((err) => console.warn('[AudioPlayer] play 中断', err));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // 音量
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // 全局快捷键触发的快进 / 快退
  useEffect(() => {
    const onSeek = (e: Event) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      const delta = Number((e as CustomEvent<{ delta: number }>).detail?.delta || 0);
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
      setCurrentTime(audio.currentTime);
    };
    const onSeekAbsolute = (e: Event) => {
      const audio = audioRef.current;
      if (!audio) return;
      const time = Number((e as CustomEvent<{ time: number }>).detail?.time || 0);
      audio.currentTime = Math.max(0, time);
      setCurrentTime(audio.currentTime);
    };
    window.addEventListener('musicbuddy:seek', onSeek);
    window.addEventListener('musicbuddy:seek-absolute', onSeekAbsolute);
    return () => {
      window.removeEventListener('musicbuddy:seek', onSeek);
      window.removeEventListener('musicbuddy:seek-absolute', onSeekAbsolute);
    };
  }, [setCurrentTime]);

  // 页面重新可见时恢复被系统挂起的播放
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const audio = audioRef.current;
      const latest = usePlayerStore.getState();
      if (audio && latest.isPlaying && audio.paused && audio.src) playSafely(audio, '页面恢复可见');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  // 歌词：以「歌名 + 艺人 + 平台」为身份标识，避免跨平台同 id 或切歌时残留上一首歌词
  const songKey = currentSong
    ? `${currentSong.platform || 'netease'}|${currentSong.id}|${currentSong.name}|${currentSong.artist}`
    : '';

  useEffect(() => {
    // 切歌瞬间立刻清空，先显示「暂无歌词」，绝不残留上一首内容
    usePlayerStore.getState().setLyric('', '');
    if (!currentSong?.id) return;

    const requestedKey = songKey;
    let cancelled = false;

    const loadLyric = async () => {
      try {
        const lyricUrl = (!currentSong.platform || currentSong.platform === 'netease')
          ? `/api/music/lyric?id=${encodeURIComponent(String(currentSong.id))}`
          : `/api/music/lyric-by-name?name=${encodeURIComponent(currentSong.name)}&artist=${encodeURIComponent(currentSong.artist)}`;
        const res = await apiFetch(lyricUrl, { timeoutMs: 10000 });
        const data = await res.json();
        if (cancelled || currentSongKey(usePlayerStore.getState().currentSong) !== requestedKey) return;
        // 后端没把握的匹配会返回空歌词，此处不回退到旧内容
        usePlayerStore.getState().setLyric(data.lyric || '', data.tlyric || '');
      } catch {
        if (cancelled || currentSongKey(usePlayerStore.getState().currentSong) !== requestedKey) return;
        usePlayerStore.getState().setLyric('', '');
      }
    };
    loadLyric();
    return () => { cancelled = true; };
  }, [songKey]);

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };
  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };
  const handleEnded = () => {
    const song = usePlayerStore.getState().currentSong;
    if (song) {
      usePlayerStore.getState().addToHistory(song);
      apiFetch('/api/ai/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'play_complete', song: { id: song.id, name: song.name, artist: song.artist } }),
      }).catch((err: unknown) => {
        console.warn('[AudioPlayer] 播放完成反馈上报失败（不影响播放）', err);
      });
    }
    if (playMode === 'single' && audioRef.current) {
      audioRef.current.currentTime = 0;
      playSafely(audioRef.current, '单曲循环');
      return;
    }
    playNext();
  };

  // 播放中途 URL 失效：强制刷新同一链接重试一次；同一首歌最多重试 1 次，避免无限循环
  const refreshAttemptRef = useRef<Record<string, number>>({});
  const handleError = async () => {
    const song = usePlayerStore.getState().currentSong;
    if (!song || !audioRef.current) return;
    const key = `${song.id}_${song.platform || 'netease'}`;
    const attempts = refreshAttemptRef.current[key] || 0;
    console.warn('[AudioPlayer] audio error，尝试刷新链接', song.name, attempts);

    if (attempts < 1) {
      refreshAttemptRef.current[key] = attempts + 1;
      setBuffering(true);
      try {
        const url = await fetchSourceUrl((song.platform || 'netease') as Platform, song.id, true);
        if (url && usePlayerStore.getState().currentSong?.id === song.id) {
          lastLoadedSongKey.current = '';
          usePlayerStore.getState().retryPlayback();
          return;
        }
      } catch { /* 刷新失败，走下一首 */ }
      setBuffering(false);
    } else {
      refreshAttemptRef.current[key] = 0;
    }

    skipRetryRef.current += 1;
    if (skipRetryRef.current >= MAX_SKIP) {
      skipRetryRef.current = 0;
      setIsPlaying(false);
      setPlaybackError({ songName: song.name, message: '连续多首歌曲播放失败，已暂停' });
      return;
    }
    setPlaybackError({ songName: song.name, message: '播放链接失效，正在切换下一首' });
    setTimeout(() => playNext(), 200);
  };

  const handleWaiting = () => setBuffering(true);
  const handlePlaying = () => { setBuffering(false); setPlaybackError(null); };

  // Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return;
    const ms = (navigator as any).mediaSession;
    ms.metadata = new (window as any).MediaMetadata({
      title: currentSong.name,
      artist: currentSong.artist,
      album: currentSong.album || '',
      artwork: currentSong.cover ? [{ src: currentSong.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    ms.setActionHandler('play', () => setIsPlaying(true));
    ms.setActionHandler('pause', () => setIsPlaying(false));
    ms.setActionHandler('previoustrack', () => playPrev());
    ms.setActionHandler('nexttrack', () => playNext());
    ms.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentSong?.id, currentSong?.name, currentSong?.artist, currentSong?.cover, currentSong?.album, isPlaying, setIsPlaying, playPrev, playNext]);

  return (
    <audio
      ref={audioRef}
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onEnded={handleEnded}
      onError={handleError}
      onWaiting={handleWaiting}
      onPlaying={handlePlaying}
      onCanPlay={() => setBuffering(false)}
      crossOrigin="anonymous"
    />
  );
}
