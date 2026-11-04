import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Search, Sparkles, ListMusic, Trash2, X, Minus,
  Headphones, Mic2, Loader2, Heart, History,
  Clock, Bot, Send, Maximize2, Sun, Moon, Shuffle, Repeat, Repeat1, ThumbsDown, Radio, LogOut, Settings
} from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import type { Song, Recommendation } from '../types';
import AudioPlayer from '../components/AudioPlayer';
import Toast from '../components/Toast';
import Waveform from '../components/Waveform';
import { isElectron, apiFetch, notify } from '../config';
import LandscapeLayout from '../components/player/LandscapeLayout';
import SongRow from '../components/player/SongRow';
import ConfirmClearButton from '../components/player/ConfirmClearButton';
import DjCard from '../components/player/DjCard';
import ChatMessageRenderer from '../components/player/ChatMessageRenderer';
import AIRadioPanel from '../components/player/AIRadioPanel';
import { GOLD, formatTime, parseLyric, sortSongsByPriority, pickBestCandidate, filterOutInstrumental, cleanSongName, mergeLyricTranslation, findTranslation } from '../components/player/utils';
import { resolveTheme, savePreferences, platformQuery, type Preferences } from '../lib/preferences';

// ========== SlidePanel 弹出面板 ==========
interface SlidePanelProps {
  show: boolean;
  onClose: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  children: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}

function SlidePanel({ show, onClose, title, icon: Icon, children, action, footer }: SlidePanelProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'var(--slide-overlay)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md mx-auto rounded-t-3xl animate-slide-up flex flex-col max-h-[85vh]"
        style={{ background: 'var(--slide-panel-bg)', borderTop: '1px solid var(--panel-border)', backdropFilter: 'blur(28px) saturate(1.3)', boxShadow: '0 -8px 40px rgba(0,0,0,0.15)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--card-bg)' }} />
        </div>
        <div className="flex items-center justify-between px-5 flex-shrink-0" style={{ height: '48px' }}>
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</span>
          </div>
          <div className="flex items-center gap-2" style={{ minWidth: '80px', justifyContent: 'flex-end' }}>
            {action}
            <button onClick={onClose} className="p-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--card-bg)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4 min-h-0">
          {children}
        </div>
        {footer && (
          <div className="flex-shrink-0 px-5 pt-3 pb-4" style={{ borderTop: '1px solid var(--card-border)', background: 'var(--slide-panel-bg)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// 清空按钮统一使用共享组件（内联二次确认 + 全局撤销浮层）
const ClearButton = ConfirmClearButton;

// ========== 主页面 ==========
interface PlayerPageProps {
  preferences: Preferences;
  onOpenSettings?: () => void;
}

export default function PlayerPage({ preferences, onOpenSettings }: PlayerPageProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'ai'>('search');
  const [showSearch, setShowSearch] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showRadio, setShowRadio] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [aiMemory, setAiMemory] = useState<{ label: string; category?: string; polarity?: 'positive' | 'negative'; key: string }[]>([]);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  // 主题由全局偏好驱动，支持「跟随系统」实时切换
  const [theme, setTheme] = useState<'dark' | 'light'>(() => resolveTheme(preferences.theme));
  const isDark = theme === 'dark';

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(preferences.theme);
      setTheme(next);
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.style.background = next === 'dark' ? '#050505' : '#faf8f5';
      localStorage.setItem('musicbuddy-theme', next);
    };
    apply();
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (preferences.theme === 'system' && mq) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [preferences.theme]);

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.background = next === 'dark' ? '#050505' : '#faf8f5';
    localStorage.setItem('musicbuddy-theme', next);
  };

  // DJ 开关：横竖版按钮与设置面板共用偏好状态，任一侧修改都立即同步
  const ttsEnabled = preferences.ttsEnabled;
  const setTtsEnabled = (v: boolean) => {
    savePreferences({ ...preferences, ttsEnabled: v });
    window.dispatchEvent(new CustomEvent('musicbuddy:preferences-changed', {
      detail: { ...preferences, ttsEnabled: v },
    }));
  };
  const djStyle = preferences.djStyle;
  const setDjStyle = (v: 'night' | 'energy' | 'literary') => {
    const next = { ...preferences, djStyle: v };
    savePreferences(next);
    window.dispatchEvent(new CustomEvent('musicbuddy:preferences-changed', { detail: next }));
  };
  const lastDjSongRef = useRef<{ name: string; artist: string } | null>(null); // DJ 连续模式：上一首歌
  // AI 电台
  const [radioCustomInput, setRadioCustomInput] = useState('');
  const [isRadioStarting, setIsRadioStarting] = useState(false);
  const isRadioExtending = useRef(false);
  const radioDislikedIds = useRef<Set<string | number>>(new Set()); // 电台模式下用户拒绝的歌
  const radioStartToken = useRef(0); // 电台启动会话 token：退出/重启时自增使旧异步任务自动放弃
  const [isFullscreen, setIsFullscreen] = useState(false);
  type FsPanel = 'none' | 'search' | 'playlist' | 'favorites' | 'history' | 'chat' | 'radio';
  // 面板持久化：用户上次主动打开的面板在冷启动后保留，避免每次都被电台引导打断
  const [fsPanel, setFsPanel] = useState<FsPanel>(() => {
    const saved = localStorage.getItem('musicbuddy-fs-panel');
    const allowed: FsPanel[] = ['none', 'search', 'playlist', 'favorites', 'history', 'chat', 'radio'];
    return allowed.includes(saved as FsPanel) ? (saved as FsPanel) : 'none';
  });
  useEffect(() => { localStorage.setItem('musicbuddy-fs-panel', fsPanel); }, [fsPanel]);

  const radioShownLandscapeRef = useRef(false);
  const radioShownPortraitRef = useRef(false);
  useEffect(() => {
    // 本次会话已展示过引导、或已有正在播放的歌曲 → 不再打断
    const guided = sessionStorage.getItem('musicbuddy-radio-guide') === '1';
    const hasSong = Boolean(usePlayerStore.getState().currentSong);
    if (guided || hasSong) { radioShownLandscapeRef.current = true; radioShownPortraitRef.current = true; return; }

    if (isFullscreen) {
      if (radioShownLandscapeRef.current) return;
      if (fsPanel !== 'none') { radioShownLandscapeRef.current = true; return; }
      setFsPanel('radio');
      radioShownLandscapeRef.current = true;
      sessionStorage.setItem('musicbuddy-radio-guide', '1');
    } else {
      if (radioShownPortraitRef.current) return;
      const t = setTimeout(() => {
        setShowRadio(true);
        sessionStorage.setItem('musicbuddy-radio-guide', '1');
      }, 250);
      radioShownPortraitRef.current = true;
      return () => clearTimeout(t);
    }
  }, [isFullscreen, fsPanel]);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const lyricRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const djScriptCache = useRef<Map<string, string>>(new Map());

  // 性能优化：用 useShallow 拆分订阅，currentTime/duration 走独立 selector
  // 避免每秒 timeupdate 都触发 1000 行组件全量 re-render
  const store = usePlayerStore(useShallow((s) => ({
    currentSong: s.currentSong,
    isPlaying: s.isPlaying,
    volume: s.volume,
    playlist: s.playlist,
    currentIndex: s.currentIndex,
    lyric: s.lyric,
    tlyric: s.tlyric,
    searchResults: s.searchResults,
    recommendation: s.recommendation,
    isSearching: s.isSearching,
    isRecommending: s.isRecommending,
    aiRecommendSongs: s.aiRecommendSongs,
    ttsUrl: s.ttsUrl,
    isTtsLoading: s.isTtsLoading,
    djScript: s.djScript,
    favorites: s.favorites,
    playHistory: s.playHistory,
    chatMessages: s.chatMessages,
    isChatLoading: s.isChatLoading,
    searchHistory: s.searchHistory,
    playMode: s.playMode,
    // actions
    setCurrentSong: s.setCurrentSong,
    setIsPlaying: s.setIsPlaying,
    setCurrentTime: s.setCurrentTime,
    setVolume: s.setVolume,
    addToPlaylist: s.addToPlaylist,
    removeFromPlaylist: s.removeFromPlaylist,
    playNext: s.playNext,
    playPrev: s.playPrev,
    setSearchResults: s.setSearchResults,
    setAiRecommendSongs: s.setAiRecommendSongs,
    setRecommendation: s.setRecommendation,
    setIsSearching: s.setIsSearching,
    setIsRecommending: s.setIsRecommending,
    setTtsUrl: s.setTtsUrl,
    setIsTtsLoading: s.setIsTtsLoading,
    setDjScript: s.setDjScript,
    clearPlaylist: s.clearPlaylist,
    addToFavorites: s.addToFavorites,
    removeFromFavorites: s.removeFromFavorites,
    isFavorite: s.isFavorite,
    clearFavorites: s.clearFavorites,
    addToHistory: s.addToHistory,
    clearHistory: s.clearHistory,
    addChatMessage: s.addChatMessage,
    deleteChatMessage: s.deleteChatMessage,
    clearChat: s.clearChat,
    setIsChatLoading: s.setIsChatLoading,
    addSearchHistory: s.addSearchHistory,
    clearSearchHistory: s.clearSearchHistory,
    setPlaySource: s.setPlaySource,
    setPlayMode: s.setPlayMode,
    playFromList: s.playFromList,
    setLyric: s.setLyric,
    radioMode: s.radioMode,
    radioStyle: s.radioStyle,
    radioStylePreset: s.radioStylePreset,
    enterRadioMode: s.enterRadioMode,
    exitRadioMode: s.exitRadioMode,
    radioRecommendedHistory: s.radioRecommendedHistory,
    addToRadioHistory: s.addToRadioHistory,
    clearRadioHistory: s.clearRadioHistory,
  })));
  // 高频字段独立订阅
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToast({ message, type });
  }, []);

  // ========== 行为反馈上报（让 AI 记忆学习用户操作）==========
  const feedbackToAi = useCallback((action: 'favorite' | 'unfavorite' | 'skip' | 'play_complete' | 'dislike', song: Song | null) => {
    if (!song) return;
    if (action === 'dislike') {
      radioDislikedIds.current.add(song.id);
    }
    apiFetch('/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, song: { id: song.id, name: song.name, artist: song.artist } }),
    }).catch(() => {/* 静默 */});
  }, []);

  // 监听 Electron 全屏
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onFullscreenChanged) {
      api.onFullscreenChanged((isFs: boolean) => setIsFullscreen(isFs));
    }
  }, []);

  // Web / PWA 环境：根据窗口宽度自动切换横竖版（iPad 横屏自动进入桌面布局）
  useEffect(() => {
    if (isElectron()) return; // Electron 由自己的全屏逻辑控制
    const handleResize = () => {
      const w = window.innerWidth;
      // >= 1024 视为横版桌面布局（覆盖 iPad Pro 横屏、桌面浏览器）
      setIsFullscreen(w >= 1024);
    };
    handleResize(); // 初始化
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 聊天自动滚底
  // 聊天自动滚底：监听消息数量、最后一条的内容长度、loading 状态
  // 用 scrollIntoView 因为 SlidePanel 的滚动容器在外层（SlidePanel 内部封装）
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const lastChatContent = store.chatMessages[store.chatMessages.length - 1]?.content || '';
  useEffect(() => {
    if (!showChat && !isFullscreen) return;
    const t = setTimeout(() => {
      lastMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 80);
    return () => clearTimeout(t);
  }, [store.chatMessages.length, lastChatContent, store.isChatLoading, showChat]);

  // ========== 搜索 ==========
  const handleSearch = useCallback(async (keyword?: string) => {
    const kw = (keyword || query).trim();
    if (!kw) return;
    store.setIsSearching(true);
    try {
      const res = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(kw)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=45`, { timeoutMs: 20000 });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const allSongs: Song[] = [];
      for (const platform of preferences.enabledPlatforms) {
        allSongs.push(...(data.results?.[platform] || []));
      }

      // 跨平台去重：同名同艺人的其他平台版本保留为「备源」，供播放失败时自动换源
      const deduped: Song[] = [];
      const seen = new Map<string, Song>();
      for (const song of allSongs) {
        const normalName = song.name.trim().toLowerCase();
        const firstArtist = song.artist.split(/[,，、&]/)[0].trim().toLowerCase();
        const key = `${normalName}_${firstArtist}`;
        const existing = seen.get(key);
        if (!existing) {
          const enriched: Song = { ...song, alternatives: [] };
          seen.set(key, enriched);
          deduped.push(enriched);
        } else {
          const target = deduped.find((s) => s === existing) || existing;
          if (song.platform && song.platform !== target.platform) {
            target.alternatives = [...(target.alternatives || []), { platform: song.platform, id: song.id }];
          }
          if (existing.fee === 1 && song.fee !== 1) {
            const idx = deduped.indexOf(existing);
            if (idx >= 0) {
              const replacement: Song = { ...song, alternatives: target.alternatives };
              deduped[idx] = replacement;
              seen.set(key, replacement);
            }
          }
        }
      }

      // 音源降级提示：让用户能区分「没这首歌」与「某平台挂了」
      const sourceNames: Record<string, string> = { netease: '网易云', qq: 'QQ 音乐', youtube: 'YouTube' };
      const degraded = Object.entries(data.sourceStatus || {})
        .filter(([, status]) => status === 'down' || status === 'unconfigured')
        .map(([p]) => sourceNames[p] || p);
      if (degraded.length > 0) notify(`${degraded.join('、')} 暂不可用，已使用其余平台`, 'info');

      // 过滤 live/DJ/综艺/翻唱等非正式发行版本，优先展示正式版
      const filtered = filterOutInstrumental(deduped);
      const finalResults = filtered.length >= 3 ? filtered : deduped;
      store.setSearchResults(sortSongsByPriority(finalResults));
      if (finalResults.length === 0) showToast('未找到相关歌曲', 'info');
      store.addSearchHistory(kw);
    } catch (e: any) {
      const detail = e.message || '未知错误';
      showToast(`搜索失败：${detail.length > 60 ? detail.slice(0, 60) + '…' : detail}`, 'error');
    } finally {
      store.setIsSearching(false);
    }
  }, [query, store, showToast]);

  // ========== 音乐档案（行为聚合 + 时段画像）==========
  const buildMusicProfile = useCallback(() => {
    const lines: string[] = [];

    // 当前情境
    if (store.currentSong) {
      lines.push(`【当前正在听】《${store.currentSong.name}》- ${store.currentSong.artist}`);
    }
    const hour = new Date().getHours();
    const period = hour < 6 ? '凌晨' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜';
    lines.push(`【当前时段】${period}（${hour}:00 左右）`);

    // 艺人 Top 5（基于收藏 + 历史频次聚合）
    const artistCount = new Map<string, number>();
    for (const s of store.favorites) {
      const a = (s.artist || '').split(/[,，、&]/)[0].trim();
      if (a) artistCount.set(a, (artistCount.get(a) || 0) + 3); // 收藏权重 3
    }
    for (const s of store.playHistory.slice(0, 50)) {
      const a = (s.artist || '').split(/[,，、&]/)[0].trim();
      if (a) artistCount.set(a, (artistCount.get(a) || 0) + 1); // 历史权重 1
    }
    const topArtists = Array.from(artistCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a, c]) => `${a}(${c})`)
      .join('、');
    if (topArtists) lines.push(`【常听艺人 Top 5】${topArtists}`);

    // 收藏代表作（最近 5 首）
    if (store.favorites.length) {
      lines.push(`【收藏代表作】${store.favorites.slice(0, 5).map((s) => `《${s.name}》${s.artist}`).join('、')}`);
    }

    // 最近高频歌曲
    if (store.playHistory.length) {
      lines.push(`【最近在听】${store.playHistory.slice(0, 6).map((s) => `《${s.name}》${s.artist}`).join('、')}`);
    }

    // 数据规模
    lines.push(`【档案规模】收藏 ${store.favorites.length} 首 / 历史 ${store.playHistory.length} 条 / 当前队列 ${store.playlist.length} 首`);

    return lines.join('\n');
  }, [store.currentSong, store.favorites, store.playHistory, store.playlist.length]);

  // ========== AI 推荐 ==========
  const handleAiRecommend = useCallback(async (autoMode = false, promptOverride?: string) => {
    const p = promptOverride || query;
    if (!autoMode && !p.trim()) return;
    store.setIsRecommending(true);
    try {
      // 附带行为信号（最近播放艺人 + 时段）
      const recentArtists = store.playHistory.slice(0, 10).map(s => s.artist).filter(Boolean).join('、');
      const hour = new Date().getHours();
      const timeContext = hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜';
      const behaviorSignals = `最近 10 首在听的艺人：${recentArtists || '无'}\n当前时段：${timeContext}`;
      const body = autoMode
        ? { musicProfile: buildMusicProfile(), behaviorSignals }
        : { prompt: p, behaviorSignals };
      const res = await apiFetch(`/api/ai/recommend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const rec: Recommendation = data.recommendation;
      store.setRecommendation(rec);
      if (rec?.songs?.length) {
        const foundSongs: Song[] = [];
        for (const item of rec.songs) {
          try {
            const sres = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(item.name + ' ' + item.artist)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=6`);
            const sdata = await sres.json();
            const candidates: Song[] = [];
            for (const platform of preferences.enabledPlatforms) {
              const songs = sdata.results?.[platform] || [];
              // 每平台取前 3 条候选，提高正式版命中率
              for (const s of songs.slice(0, 3)) candidates.push(s);
            }
            const best = pickBestCandidate(candidates);
            if (best) foundSongs.push(best);
          } catch { /* ignore */ }
        }
        store.setAiRecommendSongs(sortSongsByPriority(foundSongs));
        if (foundSongs.length === 0) showToast('未找到推荐歌曲的匹配结果', 'info');
      }
    } catch (e: any) {
      if (!autoMode) {
        showToast(e.message || 'AI推荐失败', 'error');
      }
    } finally {
      store.setIsRecommending(false);
    }
  }, [query, store, showToast, buildMusicProfile]);

  // ========== AI 电台：拉新一批推荐 ==========
  // 策略：三平台搜索 + 大候选池 + 严格过滤 fee=1（VIP/付费试听）
  // 体验目标：用户在电台里不应该遇到"VIP 才能听"的歌——找不到免费版就丢弃这首
  // 传入已推荐过的歌曲列表做去重，保持推荐新鲜度
  const fetchRadioBatch = useCallback(async (styleOverride?: string, limit = 4): Promise<Song[]> => {
    const style = styleOverride || store.radioStyle || '';
    // 收集已推荐过的歌曲列表（持久化历史 + 当前播放列表 + 播放历史）
    const currentPlaylistNames = store.playlist.map((s) => `${s.name} - ${s.artist}`);
    const playHistoryNames = store.playHistory.slice(0, 30).map((s) => `${s.name} - ${s.artist}`);
    const allRecentlyRecommended = [
      ...new Set([
        ...store.radioRecommendedHistory,
        ...currentPlaylistNames,
        ...playHistoryNames,
      ])
    ];
    try {
      const res = await apiFetch(`/api/ai/recommend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: style,
          musicProfile: buildMusicProfile(),
          behaviorSignals: `电台模式，请基于偏好档案与风格描述持续推荐 ${limit + 2} 首歌曲。注意：用户追求新鲜感，每次必须推荐没听过的新歌。`,
          recentlyRecommended: allRecentlyRecommended,
        }),
      });
      const data = await res.json();
      if (data.error || !data.recommendation?.songs?.length) return [];
      const items = data.recommendation.songs.slice(0, limit + 4);
      const results = await Promise.all(items.map(async (item: { name: string; artist: string }) => {
        try {
          // 三平台 + 每平台 5 条候选，扩大免费版本命中率
          // 搜索前清理歌名中的 (Live)/(DJ) 等后缀
          const searchName = cleanSongName(item.name);
          const sres = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(searchName + ' ' + item.artist)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=5`);
          const sdata = await sres.json();
          const candidates: Song[] = [];
          for (const platform of preferences.enabledPlatforms) {
            const songs = sdata.results?.[platform] || [];
            // 把每个平台前 3 条都纳入候选（之前只取首条，错过了首条付费但第 2 条免费的情况）
            for (const s of songs.slice(0, 3)) candidates.push(s);
          }
          // 严格过滤：只保留 fee !== 1 的（即免费 / 试听不算）
          const freeCandidates = candidates.filter((c) => c.fee !== 1);
          if (freeCandidates.length === 0) return null; // 全平台都是 VIP，丢弃这首
          return pickBestCandidate(freeCandidates);
        } catch { return null; }
      }));
      const found: Song[] = [];
      for (const best of results) {
        if (!best) continue;
        if (radioDislikedIds.current.has(best.id)) continue;
        if (store.playlist.find((s) => s.id === best.id)) continue;
        if (found.find((s) => s.id === best.id)) continue;
        found.push(best);
        if (found.length >= limit) break;
      }
      // 记录推荐历史（持久化，跨会话去重）
      if (found.length > 0) {
        store.addToRadioHistory(found.map((s) => `${s.name} - ${s.artist}`));
      }
      // 同时把 LLM 推荐的原始歌名也记录（即使没搜到，也不要下次再推荐同一首）
      const llmNames = data.recommendation.songs.map((s: { name: string; artist: string }) => `${s.name} - ${s.artist}`);
      store.addToRadioHistory(llmNames);
      return sortSongsByPriority(found);
    } catch { return []; }
  }, [store, buildMusicProfile]);

  // 启动 AI 电台：流式策略——先用第一首立即播放，其余异步追加（关键体验优化）
  // 使用 radioStartToken 作为会话 token：用户中途退出会让旧任务的所有回写自动作废
  const handleStartRadio = useCallback(async (style: string, preset: string | null) => {
    if (!style.trim()) { showToast('请先选择风格或输入描述', 'error'); return; }
    radioStartToken.current += 1;
    const myToken = radioStartToken.current;
    const isAlive = () => radioStartToken.current === myToken;

    setIsRadioStarting(true);
    showToast('AI 电台调度中…', 'info');
    try {
      // 先进入电台模式
      store.enterRadioMode(style, preset);
      // 收集已推荐过的歌曲列表做去重
      const currentPlaylistNames = store.playlist.map((s) => `${s.name} - ${s.artist}`);
      const playHistoryNames = store.playHistory.slice(0, 30).map((s) => `${s.name} - ${s.artist}`);
      const allRecentlyRecommended = [
        ...new Set([
          ...store.radioRecommendedHistory,
          ...currentPlaylistNames,
          ...playHistoryNames,
        ])
      ];
      // 先调推荐 API
      const res = await apiFetch(`/api/ai/recommend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: style,
          musicProfile: buildMusicProfile(),
          behaviorSignals: '电台模式启动，优先推荐 6-8 首匹配风格且之前没推荐过的歌曲，追求新鲜感。',
          recentlyRecommended: allRecentlyRecommended,
        }),
      });
      if (!isAlive()) return; // 用户已退出，丢弃所有后续回写
      const data = await res.json();
      const items: { name: string; artist: string }[] = data.recommendation?.songs?.slice(0, 6) || [];
      if (!items.length) {
        if (isAlive()) {
          showToast('AI 电台暂时无法生成推荐，请稍后再试', 'error');
          store.exitRadioMode();
        }
        return;
      }
      // 流式：第一首先找到就立即播放
      let firstStarted = false;
      const seen = new Set<string | number>();

      const trackedSearches = items.map((item) => {
        // 搜索前清理歌名中的非正式版本后缀
        const searchName = cleanSongName(item.name);
        return apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(searchName + ' ' + item.artist)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=5`)
          .then((r) => r.json())
          .then((sdata) => {
            if (!isAlive()) return null;
            const candidates: Song[] = [];
            for (const platform of preferences.enabledPlatforms) {
              const songs = sdata.results?.[platform] || [];
              for (const s of songs.slice(0, 3)) candidates.push(s);
            }
            // 严格过滤：必须找到免费版本，否则丢弃
            const freeCandidates = candidates.filter((c) => c.fee !== 1);
            const best = freeCandidates.length > 0 ? pickBestCandidate(freeCandidates) : null;
            if (best && !firstStarted && !radioDislikedIds.current.has(best.id) && !seen.has(best.id)) {
              if (!isAlive()) return null;
              firstStarted = true;
              seen.add(best.id);
              usePlayerStore.setState({
                playlist: [best],
                currentIndex: 0,
                currentSong: best,
                currentTime: 0,
                isPlaying: true,
                playSource: 'radio',
              });
              showToast('电台已开启', 'success');
            }
            return best;
          })
          .catch(() => null);
      });

      const allResults = await Promise.all(trackedSearches);
      if (!isAlive()) return; // 退出后不再追加任何歌
      const ordered = sortSongsByPriority(allResults.filter((s): s is Song => !!s));
      for (const song of ordered) {
        if (!isAlive()) return; // 中途退出立即停止
        if (radioDislikedIds.current.has(song.id)) continue;
        if (seen.has(song.id)) continue;
        seen.add(song.id);
        const cur = usePlayerStore.getState();
        if (!cur.playlist.find((p) => p.id === song.id)) {
          cur.addToPlaylist(song);
        }
      }
      if (!firstStarted && isAlive()) {
        showToast('AI 电台暂时无法生成推荐，请稍后再试', 'error');
        store.exitRadioMode();
      }
      // 记录推荐历史（持久化，跨会话去重）
      if (isAlive()) {
        // 记录 LLM 推荐的原始歌名（即使没搜到，也不要下次再推荐同一首）
        const llmNames = items.map((item) => `${item.name} - ${item.artist}`);
        store.addToRadioHistory(llmNames);
        // 记录实际入队的歌名
        const queuedNames = Array.from(seen).length > 0
          ? usePlayerStore.getState().playlist.map((s) => `${s.name} - ${s.artist}`)
          : [];
        if (queuedNames.length > 0) store.addToRadioHistory(queuedNames);
      }
    } catch (e: any) {
      if (isAlive()) {
        showToast(e?.message || '电台启动失败', 'error');
        store.exitRadioMode();
      }
    } finally {
      // 仅当本次会话仍有效时清 loading；否则 handleExitRadio 已经清了
      if (isAlive()) setIsRadioStarting(false);
    }
  }, [store, showToast, buildMusicProfile]);

  // 退出电台模式：立即作废所有正在跑的启动任务，强制清 loading
  const handleExitRadio = useCallback(() => {
    radioStartToken.current += 1; // 关键：让 handleStartRadio 内的 isAlive() 立刻返回 false
    setIsRadioStarting(false);     // 立即解除 loading
    store.exitRadioMode();
    radioDislikedIds.current.clear();
    showToast('已退出电台模式', 'info');
  }, [store, showToast]);

  // 电台续流：监听到电台模式下当前是 playlist 末尾且 isPlaying=false（playNext 已暂停等续流）→ 拉新追加
  useEffect(() => {
    if (store.radioMode !== 'station') return;
    if (isRadioExtending.current) return;
    const { playlist, currentIndex, isPlaying } = store;
    if (playlist.length === 0) return;
    // 触发条件：当前播完最后一首被 store 暂停（playNext 在末尾时设 isPlaying=false）
    const isAtEnd = currentIndex >= playlist.length - 1;
    if (!isAtEnd) return;
    if (isPlaying) return; // 还在播
    isRadioExtending.current = true;
    (async () => {
      try {
        const songs = await fetchRadioBatch(undefined, 4);
        // 异步回来时如果用户已退出电台，整段作废
        if (usePlayerStore.getState().radioMode !== 'station') return;
        if (!songs.length) {
          // 释放续流锁并给出明确反馈，用户可以点播控「下一首」再次触发续流
          showToast('电台续流失败，点下一首可重试，或退出电台', 'error');
          isRadioExtending.current = false;
          return;
        }
        for (const s of songs) {
          if (usePlayerStore.getState().radioMode !== 'station') return;
          if (!usePlayerStore.getState().playlist.find((p) => p.id === s.id)) {
            usePlayerStore.getState().addToPlaylist(s);
          }
        }
        // 播放追加后的下一首
        if (usePlayerStore.getState().radioMode !== 'station') return;
        const after = usePlayerStore.getState();
        const next = after.playlist[after.currentIndex + 1];
        if (next) {
          usePlayerStore.setState({
            currentIndex: after.currentIndex + 1,
            currentSong: next,
            currentTime: 0,
            isPlaying: true,
          });
        }
      } finally {
        isRadioExtending.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.radioMode, store.currentIndex, store.playlist.length, store.isPlaying]);

  // 播放由用户主动触发，队列末尾按来源决定是否续流。
  // 它们会在普通播放（如收藏/历史）时偷偷往 playlist 追加 AI 推荐歌曲，
  // 导致用户在收藏里听完一首后下一首跳到 AI 推荐而不是收藏的下一首——这是核心污染源。
  // 自动 AI 续流职责由 AI 电台模式（radioMode='station'）独占，普通播放保持纯粹。

  // ========== TTS ==========
  const ttsCancelTokenRef = useRef(0); // 切歌/换风格自增，旧 TTS 任务会自检放弃
  // 注意：stopTts 必须保持稳定引用，否则依赖它的 effect 会被反复 cleanup，导致 token 被错误自增
  const stopTtsRef = useRef<() => void>(() => {});
  stopTtsRef.current = () => {
    ttsCancelTokenRef.current += 1;
    if (ttsAudioRef.current) {
      try {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.onended = null;
        ttsAudioRef.current.onerror = null;
        ttsAudioRef.current.src = '';
      } catch { /* ignore */ }
      ttsAudioRef.current = null;
    }
    usePlayerStore.getState().setIsTtsLoading(false);
  };

  const handleTts = useCallback(async (text: string) => {
    if (!ttsEnabled || !text) return;
    store.setIsTtsLoading(true);
    stopTtsRef.current();
    const myToken = ttsCancelTokenRef.current; // 本次任务 token
    if (store.isPlaying) store.setIsPlaying(false);
    try {
      const res = await apiFetch(`/api/tts/synthesize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      // token 已变（说明用户切歌或换风格）→ 放弃
      if (ttsCancelTokenRef.current !== myToken) return;
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.audioSegments?.length) throw new Error('语音合成返回空数据');
      let segmentIndex = 0;
      const playNextSegment = () => {
        // 每段播放前都检查 token，发现已被取消立即停止
        if (ttsCancelTokenRef.current !== myToken) {
          ttsAudioRef.current = null;
          return;
        }
        if (segmentIndex >= data.audioSegments.length) {
          ttsAudioRef.current = null; store.setIsTtsLoading(false);
          if (ttsEnabled) store.setIsPlaying(true);
          return;
        }
        const audio = new Audio(`data:audio/mp3;base64,${data.audioSegments[segmentIndex]}`);
        audio.volume = Math.min(store.volume * 1.3, 1.0);
        ttsAudioRef.current = audio;
        audio.onended = () => { segmentIndex++; playNextSegment(); };
        audio.onerror = () => { segmentIndex++; playNextSegment(); };
        audio.play().catch(() => { segmentIndex++; playNextSegment(); });
      };
      playNextSegment();
    } catch (e: any) { store.setIsTtsLoading(false); showToast(e.message || '语音合成失败', 'error'); }
  }, [ttsEnabled, store, showToast]);

  // ========== DJ 解说 ==========
  const prevSongIdRef = useRef<string | number | null>(null);
  const prevDjStyleRef = useRef(djStyle);
  useEffect(() => {
    const song = store.currentSong;
    const songId = song?.id ?? null;
    const styleChanged = prevDjStyleRef.current !== djStyle;
    prevDjStyleRef.current = djStyle;

    // 切歌时清空旧解说（检查缓存），风格切换时清除当前缓存
    if (songId !== prevSongIdRef.current) {
      // 仅当存在上一首歌（prevSongIdRef.current 非 null）才停 TTS，避免首次 mount 误触发
      if (prevSongIdRef.current !== null) {
        stopTtsRef.current();
      }
      prevSongIdRef.current = songId;
      if (songId && djScriptCache.current.has(String(songId))) {
        store.setDjScript(djScriptCache.current.get(String(songId))!);
        return;
      }
      store.setDjScript(null);
    } else if (styleChanged && songId) {
      // 风格切换：清除当前歌曲缓存，强制重新生成（同时停旧 TTS）
      stopTtsRef.current();
      djScriptCache.current.delete(String(songId));
      store.setDjScript(null);
    }

    if (!song || !ttsEnabled) return;
    if (store.djScript && !styleChanged) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/ai/dj-script`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            songName: song.name, artist: song.artist, album: song.album,
            style: djStyle,
            prevSong: lastDjSongRef.current,
          }),
        });
        const data = await res.json();
        if (data.error || !data.script || cancelled) return;
        djScriptCache.current.set(String(song.id), data.script);
        store.setDjScript(data.script);
        lastDjSongRef.current = { name: song.name, artist: song.artist };
        handleTts(data.script);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [store.currentSong?.id, ttsEnabled, djStyle]);

  // 组件卸载时停 TTS（仅 unmount 一次，不依赖 stopTts 引用变化）
  useEffect(() => { return () => { stopTtsRef.current(); }; }, []);

  // ========== 播放歌曲 ==========
  // 按来源区分：列表播放接续各自来源
  //  - favorites / history / playlist：把整个来源列表设为播放队列，从点击位置开始（"播完这个分区"）
  //  - search / aiRecommend：只追加单首（避免大量搜索结果污染队列）
  // 任何主动选歌都会退出电台模式（电台是独立形态，混在一起会乱）
  // URL 获取失败时仍切换到对应列表，并跳过这首播下一首
  const handlePlaySong = async (song: Song, source?: 'playlist' | 'favorites' | 'history' | 'search', sourceList?: Song[]) => {
    let finalSong = { ...song };
    let urlFailed = false;
    if (song.platform && song.platform !== 'netease') {
      if (song.platform === 'youtube') showToast('正在获取音频...', 'info');
      try {
        const res = await apiFetch(`/api/music/multi-url?platform=${song.platform}&id=${encodeURIComponent(String(song.id))}`);
        const data = await res.json();
        setToast(null);
        if (data.url) {
          finalSong.url = data.url;
        } else {
          urlFailed = true;
          showToast('该歌曲播放链接暂时失效，跳到下一首', 'error');
        }
      } catch { setToast(null); urlFailed = true; showToast('网络异常，跳到下一首', 'error'); }
    }
    if (!finalSong.cover && (!song.platform || song.platform === 'netease')) {
      try {
        const res = await apiFetch(`/api/music/detail?ids=${song.id}`);
        const data = await res.json();
        if (data.songs?.[0]?.cover) finalSong.cover = data.songs[0].cover;
      } catch { /* ignore */ }
    }

    // 主动选歌 → 退出电台模式（避免电台续流污染分区独立的播放体验）
    if (usePlayerStore.getState().radioMode === 'station') {
      radioStartToken.current += 1; // 取消任何正在跑的电台启动任务
      setIsRadioStarting(false);
      usePlayerStore.getState().exitRadioMode();
    }

    const finalSource = source || 'playlist';

    if (finalSource === 'favorites' || finalSource === 'history' || finalSource === 'playlist') {
      // 整列表入队策略：把来源列表设为 playlist，定位到点击的歌
      const list = sourceList || (finalSource === 'favorites' ? store.favorites : finalSource === 'history' ? store.playHistory : store.playlist);
      if (!list.length) {
        if (!urlFailed) store.playFromList([finalSong], 0, finalSource);
      } else {
        const idx = list.findIndex((s) => s.id === song.id);
        const safeList = list.map((s) => s.id === song.id ? finalSong : s);
        if (urlFailed) {
          // URL 失败：仍然切换到该列表，但定位到下一首（跳过失败的这首）
          const nextIdx = Math.min((idx >= 0 ? idx : 0) + 1, safeList.length - 1);
          store.playFromList(safeList, nextIdx, finalSource);
        } else {
          store.playFromList(safeList, Math.max(0, idx), finalSource);
        }
      }
    } else {
      // search / 其他：单首追加策略 — URL 失败则直接跳过
      if (urlFailed) return;
      const existing = store.playlist.findIndex((s) => s.id === song.id);
      if (existing >= 0) {
        store.playFromList(store.playlist.map((s, i) => i === existing ? finalSong : s), existing, finalSource);
      } else {
        const newList = [...store.playlist, finalSong];
        store.playFromList(newList, newList.length - 1, finalSource);
      }
    }
    // 不再主动写历史：歌曲实际播完（onEnded）才进历史
  };

  // ========== 歌词 ==========
  // 性能：parseLyric 仅在 lyric 变化时跑（之前每秒触发 N 次）
  const lyrics = useMemo(() => parseLyric(store.lyric), [store.lyric]);
  // 翻译歌词按时间戳对齐，支持双语显示
  const translationMap = useMemo(
    () => mergeLyricTranslation(store.tlyric),
    [store.tlyric]
  );
  const seekToLyricTime = useCallback((time: number) => {
    window.dispatchEvent(new CustomEvent('musicbuddy:seek-absolute', { detail: { time } }));
    store.setCurrentTime(time);
  }, [store]);
  // LRC 时间戳普遍略晚 200-400ms，+0.3s 预读补偿，让歌词与演唱真正同步
  const activeLyricIndex = lyrics.findIndex((l, i) => {
    const next = lyrics[i + 1];
    const t = currentTime + 0.3;
    return t >= l.time && (!next || t < next.time);
  });

  const lastScrolledIndex = useRef(-1);
  useEffect(() => {
    if (!lyricRef.current || activeLyricIndex < 0 || activeLyricIndex === lastScrolledIndex.current) return;
    lastScrolledIndex.current = activeLyricIndex;
    const el = lyricRef.current.children[activeLyricIndex] as HTMLElement | undefined;
    if (!el) return;
    requestAnimationFrame(() => {
      const container = lyricRef.current;
      if (!container) return;
      const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
  }, [activeLyricIndex]);

  const currentSong = store.currentSong;
  const isPlaying = store.isPlaying;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ========== 进度条 ==========
  const progressRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const seekTo = useCallback((clientX: number) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = percent * duration;
    usePlayerStore.getState().setCurrentTime(t);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    if (audio) audio.currentTime = t;
  }, [duration]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (isDragging.current) seekTo(e.clientX); };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [seekTo]);

  // ========== AI 聊天 ==========
  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || store.isChatLoading) return;
    store.addChatMessage({ role: 'user', content: text, timestamp: Date.now() });
    setChatInput('');
    store.setIsChatLoading(true);
    try {
      const history = store.chatMessages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      // 注入当前歌曲上下文，让 AI 知道用户在听什么
      const songContext = store.currentSong
        ? `[当前正在播放：《${store.currentSong.name}》- ${store.currentSong.artist}${store.currentSong.album ? `，专辑《${store.currentSong.album}》` : ''}]\n`
        : '';
      const enrichedText = songContext ? songContext + text : text;
      const res = await apiFetch(`/api/ai/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', content: enrichedText }], musicProfile: buildMusicProfile() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      store.addChatMessage({ role: 'assistant', content: data.reply || '暂时不知道怎么回答呢', timestamp: Date.now() });
      try {
        await apiFetch(`/api/ai/extract-memory`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation: [...history, { role: 'user', content: text }, { role: 'assistant', content: data.reply }] }),
        });
      } catch { /* ignore */ }
    } catch (e: any) {
      store.addChatMessage({ role: 'assistant', content: `抱歉，AI 暂时出错了：${e.message || '未知错误'}`, timestamp: Date.now() });
    } finally { store.setIsChatLoading(false); }
  }, [chatInput, store, buildMusicProfile]);

  const loadAiMemory = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/ai/memory`);
      const data = await res.json();
      if (!data.memory) return;
      // 精炼展示：优先按权重排序 Top 8，提炼 tag 作为主标签，去掉"用户喜欢"冗余前缀
      const catLabel: Record<string, string> = {
        artist: '艺人', genre: '风格', mood: '情绪', scene: '场景', song: '歌曲', dislike: '不喜欢', fact: '',
      };
      const entries = (data.memory as any[])
        .slice()
        .sort((a, b) => {
          // 按 count 和新鲜度排序
          const scoreA = Math.log(1 + (a.count || 1)) + Math.exp(-(Date.now() - (a.lastSeen || 0)) / (14 * 86400000));
          const scoreB = Math.log(1 + (b.count || 1)) + Math.exp(-(Date.now() - (b.lastSeen || 0)) / (14 * 86400000));
          return scoreB - scoreA;
        })
        .slice(0, 8)
        .map((m: any) => {
          let label: string;
          if (m.tag && m.category && m.category !== 'fact') {
            const prefix = catLabel[m.category] || '';
            const neg = m.polarity === 'negative' ? '不喜欢' : '';
            label = prefix && !neg ? `${prefix}·${m.tag}` : neg ? `不喜欢·${m.tag}` : m.tag;
          } else {
            // 回退：清洗旧格式的"用户喜欢"前缀
            label = (m.content || '').replace(/^用户(喜欢|偏爱|偏好|常听|最近在听|常用|想|提到)/, '').trim() || m.content;
          }
          const key = `${m.category}::${(m.tag || m.content || '').toLowerCase()}::${m.polarity || 'positive'}`;
          return { label, category: m.category, polarity: m.polarity, key };
        });
      setAiMemory(entries);
    } catch { /* ignore */ }
  }, []);

  const deleteAiMemory = useCallback(async (key: string) => {
    try {
      const res = await apiFetch(`/api/ai/memory/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      setAiMemory((prev) => prev.filter((m) => m.key !== key));
      showToast('已删除该条记忆', 'success');
    } catch {
      showToast('删除记忆失败', 'error');
    }
  }, [showToast]);

  const handleDjQuickChat = useCallback(() => {
    if (!chatInput.trim()) return;
    handleChatSend();
    if (isFullscreen) { setFsPanel('chat'); }
    else { setShowChat(true); loadAiMemory(); }
  }, [chatInput, handleChatSend, isFullscreen, loadAiMemory]);

  // ========== AI 对话可执行指令 ==========
  const handleChatPlayIntent = useCallback(async (name: string, artist: string) => {
    // 先走三平台搜索找到真正可播的歌，再调 handlePlaySong
    showToast(`正在找《${name}》...`, 'info');
    try {
      const res = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(name + ' ' + artist)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=3`);
      const data = await res.json();
      const candidates: Song[] = [];
      for (const platform of preferences.enabledPlatforms) {
        const songs = data.results?.[platform] || [];
        if (songs.length > 0) candidates.push(songs[0]);
      }
      const best = pickBestCandidate(candidates);
      setToast(null);
      if (!best) { showToast(`没找到《${name}》`, 'error'); return; }
      handlePlaySong(best, 'search');
    } catch {
      setToast(null);
      showToast('搜索失败', 'error');
    }
  }, [showToast]);

  // 批量入队：并行搜索 N 首，一次性写入播放列表，避免 forEach 多次切歌相互覆盖
  const handleChatBatchPlay = useCallback(async (items: { song: string; artist: string }[]) => {
    if (!items.length) return;
    showToast(`正在准备 ${items.length} 首歌...`, 'info');
    try {
      const results = await Promise.all(items.map(async ({ song, artist }) => {
        try {
          const res = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(song + ' ' + artist)}&platforms=${platformQuery(preferences.enabledPlatforms)}&limit=3`);
          const data = await res.json();
          const candidates: Song[] = [];
          for (const platform of preferences.enabledPlatforms) {
            const songs = data.results?.[platform] || [];
            if (songs.length > 0) candidates.push(songs[0]);
          }
          return pickBestCandidate(candidates);
        } catch { return null; }
      }));

      // 主动选歌 → 退出电台模式
      if (usePlayerStore.getState().radioMode === 'station') {
        radioStartToken.current += 1;
        setIsRadioStarting(false);
        usePlayerStore.getState().exitRadioMode();
      }

      const found = results.filter((s): s is Song => !!s);
      setToast(null);
      if (!found.length) { showToast('几首歌都没找到', 'error'); return; }

      // 解析非 netease 平台的真实 url（并行）
      const finalSongs = await Promise.all(found.map(async (s) => {
        if (s.platform && s.platform !== 'netease') {
          try {
            const res = await apiFetch(`/api/music/multi-url?platform=${s.platform}&id=${encodeURIComponent(String(s.id))}`);
            const data = await res.json();
            if (data.url) return { ...s, url: data.url };
          } catch { /* ignore */ }
          return null;
        }
        return s;
      }));
      const playable = finalSongs.filter((s): s is Song => !!s);
      if (!playable.length) { showToast('几首歌都获取链接失败', 'error'); return; }

      // 追加到当前播放列表末尾，从第一首新歌开始播
      const currentList = usePlayerStore.getState().playlist;
      // 去重：已存在的歌不再追加
      const existingIds = new Set(currentList.map((s) => s.id));
      const toAdd = playable.filter((s) => !existingIds.has(s.id));
      const newList = [...currentList, ...toAdd];
      const startIndex = currentList.length; // 第一首新歌的位置
      // 若所有新歌都已存在，定位到第一首
      const firstIdx = toAdd.length ? startIndex : currentList.findIndex((s) => s.id === playable[0].id);
      usePlayerStore.getState().playFromList(newList, Math.max(0, firstIdx), 'search');
      showToast(`已加入 ${toAdd.length || playable.length} 首歌`, 'success');
    } catch {
      setToast(null);
      showToast('批量加入失败', 'error');
    }
  }, [showToast]);

  const handleChatOpenPanel = useCallback((panel: string) => {
    if (isFullscreen) {
      if (['search', 'playlist', 'favorites', 'history'].includes(panel)) {
        setFsPanel(panel as any);
      }
    } else {
      if (panel === 'search') setShowSearch(true);
      else if (panel === 'playlist') setShowPlaylist(true);
      else if (panel === 'favorites') setShowFavorites(true);
      else if (panel === 'history') setShowHistory(true);
    }
  }, [isFullscreen]);

  const handleChatRecommendIntent = useCallback((prompt: string) => {
    if (prompt) setQuery(prompt);
    handleAiRecommend(false, prompt || undefined);
    if (isFullscreen) setFsPanel('search');
    else setShowSearch(true);
    setMode('ai');
  }, [handleAiRecommend, isFullscreen]);

  // 关闭面板的 helper
  const closeAllPanels = useCallback(() => {
    setShowSearch(false); setShowFavorites(false); setShowHistory(false);
  }, []);

  // ============ 单一 return：AudioPlayer 只渲染一次，横竖版条件切换 ============
  return (
    <>
      <AudioPlayer />
      {isFullscreen ? (
        <LandscapeLayout
          isDark={isDark} ttsEnabled={ttsEnabled} djStyle={djStyle} fsPanel={fsPanel} mode={mode}
          query={query} chatInput={chatInput} aiMemory={aiMemory} toast={toast}
          radioCustomInput={radioCustomInput} isRadioStarting={isRadioStarting}
          setIsFullscreen={setIsFullscreen} setTtsEnabled={setTtsEnabled} setDjStyle={setDjStyle} setFsPanel={setFsPanel}
          setMode={setMode} setQuery={setQuery} setChatInput={setChatInput} setToast={setToast}
          setRadioCustomInput={setRadioCustomInput}
          toggleTheme={toggleTheme} onOpenSettings={onOpenSettings} showTranslation={preferences.showTranslation} handleSearch={handleSearch} handleAiRecommend={handleAiRecommend}
          handlePlaySong={handlePlaySong} handleChatSend={handleChatSend} handleDjQuickChat={handleDjQuickChat}
          showToast={showToast} feedbackToAi={feedbackToAi}
          onChatPlayIntent={handleChatPlayIntent}
          onChatBatchPlay={handleChatBatchPlay}
          onChatRecommendIntent={handleChatRecommendIntent}
          onChatOpenPanel={handleChatOpenPanel}
          onStartRadio={handleStartRadio}
          onExitRadio={handleExitRadio}
        />
      ) : (
    <div className="flex flex-col h-screen overflow-hidden relative"
      style={{ background: 'var(--bg-gradient)', color: 'var(--text-primary)' }}>
      {/* 环境光 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, var(--cover-glow-color) 0%, transparent 70%)' }} />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, var(--ambient-glow) 0%, transparent 70%)' }} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* 拖拽区 + macOS 按钮（仅 Electron） */}
      {isElectron() ? (
        <div className="w-full h-8 flex-shrink-0 z-50 relative" style={{ ['WebkitAppRegion' as string]: 'drag', cursor: 'default' }}>
          <div className="absolute left-3 top-2.5 z-50 flex items-center gap-2" style={{ ['WebkitAppRegion' as string]: 'no-drag' }}>
            <button onClick={() => { if ((window as any).electronAPI?.close) (window as any).electronAPI.close(); else window.close(); }}
              className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group" style={{ background: '#ff5f57' }}>
              <X className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#4a0002' }} />
            </button>
            <button onClick={() => { if ((window as any).electronAPI?.minimize) (window as any).electronAPI.minimize(); }}
              className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group" style={{ background: '#febc2e' }}>
              <Minus className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#985700' }} />
            </button>
            <button onClick={async () => { if ((window as any).electronAPI?.toggleFullscreen) { const fs = await (window as any).electronAPI.toggleFullscreen(); setIsFullscreen(fs); } }}
              className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group" style={{ background: '#28c840' }}>
              <Maximize2 className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#006500' }} />
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full flex-shrink-0" style={{ height: 'env(safe-area-inset-top, 12px)' }} />
      )}

      {/* Header */}
      <div className="flex-shrink-0 z-40" style={{ background: 'var(--header-bg)', backdropFilter: 'blur(24px) saturate(1.3)' }}>
        <div className="w-full max-w-md mx-auto flex items-center justify-between px-6 pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            <img src="./icons/icon-32.png" alt="MusicBuddy" className="w-7 h-7 rounded-lg" />
            <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>MusicBuddy</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(true)} className="p-2 rounded-xl transition-all hover:bg-black/5"><Clock className="w-4 h-4" style={{ color: 'var(--text-icon)' }} /></button>
            <button onClick={() => setShowFavorites(true)} className="p-2 rounded-xl transition-all hover:bg-black/5"><Heart className="w-4 h-4" style={{ color: store.favorites.length > 0 ? GOLD : 'var(--text-icon)' }} /></button>
            <button onClick={() => setTtsEnabled(!ttsEnabled)}
              className="p-2 rounded-xl transition-all hover:bg-black/5"
              style={{ color: ttsEnabled ? GOLD : 'var(--text-icon)' }}>
              <Mic2 className="w-4 h-4" />
            </button>
            <button onClick={toggleTheme} className="p-2 rounded-xl transition-all hover:bg-black/5"
              style={{ color: 'var(--text-icon)' }} aria-label="切换主题">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={onOpenSettings} className="p-2 rounded-xl transition-all hover:bg-black/5"
              style={{ color: 'var(--text-icon)' }} aria-label="打开设置" title="设置">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <main className="flex-1 flex flex-col items-center overflow-hidden relative">
        <div className="flex-1 w-full max-w-md flex flex-col items-center px-6 overflow-y-auto pb-32">
          {/* 波形 */}
          <div className="w-full mt-1 mb-4"><Waveform isPlaying={isPlaying} /></div>

          {/* 封面 */}
          {currentSong ? (
            <div className="relative mb-6 animate-fade-in">
              <div className="absolute inset-0 rounded-3xl blur-3xl opacity-15" style={{ background: isPlaying ? GOLD : 'var(--card-bg)', transform: 'scale(0.8)' }} />
              <div className={`relative w-56 h-56 rounded-3xl overflow-hidden ${isPlaying ? 'animate-float' : ''}`} style={{ boxShadow: 'var(--cover-shadow)' }}>
                {currentSong.cover ? (
                  <img src={currentSong.cover} alt="" className={`w-full h-full object-cover ${isPlaying ? 'scale-105' : 'scale-100'} transition-transform duration-1000`} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--card-bg)' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="w-56 h-56 rounded-3xl flex items-center justify-center mb-6 animate-fade-in"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)', backdropFilter: 'blur(8px)' }}>
              <Headphones className="w-16 h-16" style={{ color: 'var(--text-tertiary)' }} />
            </div>
          )}

          {/* 歌曲信息 */}
          <div className="text-center w-full relative">
            <h1 className="text-2xl font-bold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>{currentSong?.name || '选择一首歌曲'}</h1>
            <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>{currentSong?.artist || '搜索或让 AI 推荐'}</p>
            {currentSong?.platform && (
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                  background: currentSong.platform === 'youtube' ? 'rgba(255,0,0,0.12)' : currentSong.platform === 'qq' ? 'rgba(201,169,110,0.12)' : 'rgba(100,149,237,0.12)',
                  color: currentSong.platform === 'youtube' ? 'rgba(255,80,80,0.85)' : currentSong.platform === 'qq' ? 'rgba(201,169,110,0.85)' : 'rgba(100,149,237,0.85)',
                  border: `1px solid ${currentSong.platform === 'youtube' ? 'rgba(255,0,0,0.2)' : currentSong.platform === 'qq' ? 'rgba(201,169,110,0.2)' : 'rgba(100,149,237,0.2)'}`,
                }}>{currentSong.platformName || currentSong.platform}</span>
                {currentSong.fee === 1 ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(255,100,100,0.15)' : 'rgba(220,50,50,0.08)', color: isDark ? 'rgba(255,120,120,0.85)' : 'rgba(200,50,50,0.75)', border: `1px solid ${isDark ? 'rgba(255,100,100,0.2)' : 'rgba(200,50,50,0.15)'}` }}>试听</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(100,255,100,0.1)' : 'rgba(30,160,60,0.08)', color: isDark ? 'rgba(100,255,100,0.8)' : 'rgba(30,140,50,0.75)', border: `1px solid ${isDark ? 'rgba(100,255,100,0.2)' : 'rgba(30,160,60,0.15)'}` }}>免费</span>
                )}
              </div>
            )}
          </div>

          {/* 找相似 */}
          {currentSong && (
            <button onClick={() => {
              const p = `推荐5首和《${currentSong.name}》(${currentSong.artist})风格相似的歌曲`;
              setQuery(p); setMode('ai'); setShowSearch(true);
              handleAiRecommend(false, p);
            }}
              className="mt-3 text-[11px] px-4 py-1.5 rounded-full transition-all hover:opacity-80 font-medium"
              style={{ background: 'rgba(201,169,110,0.1)', color: GOLD, border: '1px solid rgba(201,169,110,0.2)' }}>
              找相似歌曲
            </button>
          )}

          {/* 进度条 */}
          <div className="w-full mt-8">
            <div ref={progressRef} className="relative w-full h-1 rounded-full cursor-pointer group" style={{ background: 'var(--card-bg)' }}
              onClick={(e) => seekTo(e.clientX)} onMouseDown={(e) => { isDragging.current = true; seekTo(e.clientX); }}>
              <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-100" style={{ width: `${progressPercent}%`, background: GOLD }} />
              <div className="absolute top-1/2 w-2 h-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progressPercent}%`, transform: 'translate(-50%, -50%)', background: GOLD, boxShadow: '0 0 6px rgba(201,169,110,0.4)' }} />
            </div>
            <div className="flex justify-between text-[11px] mt-2 font-medium" style={{ color: 'var(--text-icon)', fontFamily: "'Poppins', monospace" }}>
              <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* 控制 */}
          <div className="flex items-center gap-6 mt-6">
            <button
              onClick={() => {
                const next = store.playMode === 'order' ? 'shuffle' : store.playMode === 'shuffle' ? 'single' : 'order';
                store.setPlayMode(next);
                showToast(next === 'order' ? '顺序播放' : next === 'shuffle' ? '随机播放' : '单曲循环', 'info');
              }}
              className="p-2 rounded-full transition-all hover:scale-110 active:scale-95"
              title={store.playMode === 'order' ? '顺序播放' : store.playMode === 'shuffle' ? '随机播放' : '单曲循环'}
              style={{ background: 'var(--card-bg)', color: store.playMode !== 'order' ? GOLD : 'var(--text-secondary)' }}>
              {store.playMode === 'shuffle' ? <Shuffle className="w-4 h-4" /> : store.playMode === 'single' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            </button>
            <button onClick={() => store.playPrev()} className="p-3 rounded-full transition-all hover:scale-110 active:scale-95" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(10px)' }}>
              <SkipBack className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
            <button onClick={() => store.setIsPlaying(!isPlaying)} className="p-5 rounded-full transition-all hover:scale-105 active:scale-95"
              style={{ background: currentSong ? GOLD : 'var(--card-bg)', boxShadow: currentSong ? '0 8px 30px rgba(201,169,110,0.35)' : 'none', backdropFilter: 'blur(10px)' }}>
              {isPlaying ? <Pause className="w-7 h-7 text-white" /> : <Play className="w-7 h-7 text-white ml-0.5" />}
            </button>
            <button onClick={() => store.playNext()} className="p-3 rounded-full transition-all hover:scale-110 active:scale-95" style={{ background: 'var(--card-bg)', backdropFilter: 'blur(10px)' }}>
              <SkipForward className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
            <div className="w-8" />
          </div>

          {/* 音量 + 喜欢/不喜欢（与横版一致的一行排版） */}
          <div className="flex items-center gap-3 mt-5 w-64">
            <button onClick={() => store.setVolume(store.volume > 0 ? 0 : 0.7)} style={{ color: 'var(--text-tertiary)' }}>
              {store.volume > 0 ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={store.volume} onChange={(e) => store.setVolume(Number(e.target.value))} className="flex-1" />
            {currentSong && (
              <>
                <button
                  onClick={() => { if (store.isFavorite(currentSong.id)) { store.removeFromFavorites(currentSong.id); feedbackToAi('unfavorite', currentSong); } else { store.addToFavorites(currentSong); feedbackToAi('favorite', currentSong); } }}
                  className="p-1 rounded-lg transition-all hover:opacity-70"
                  title={store.isFavorite(currentSong.id) ? '取消收藏' : '加入收藏'}
                >
                  <Heart className="w-4 h-4" style={{ color: store.isFavorite(currentSong.id) ? GOLD : 'var(--text-tertiary)' }} fill={store.isFavorite(currentSong.id) ? GOLD : 'none'} />
                </button>
                <button
                  onClick={() => { feedbackToAi('dislike', currentSong); store.playNext(); showToast('已告诉AI你不喜欢这首', 'info'); }}
                  className="p-1 rounded-lg transition-all hover:opacity-70"
                  title="不喜欢，跳过并告诉AI"
                >
                  <ThumbsDown className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                </button>
              </>
            )}
          </div>

          {/* AI 电台模式徽标 */}
          {store.radioMode === 'station' && (
            <div className="mt-3 flex items-center justify-center gap-2 px-3 py-1.5 rounded-full mx-auto w-fit" style={{
              background: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(201,169,110,0.2)',
              border: `1px solid ${isDark ? 'rgba(201,169,110,0.35)' : 'rgba(201,169,110,0.45)'}`,
            }}>
              <Radio className="w-3 h-3" style={{ color: GOLD }} />
              <span className="text-[10px] font-semibold" style={{ color: GOLD }}>AI 电台</span>
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>·</span>
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{store.radioStyle && store.radioStyle.length > 12 ? store.radioStyle.slice(0, 12) + '…' : (store.radioStyle || '自定义')}</span>
              <button onClick={handleExitRadio} className="ml-0.5 p-0.5 rounded-full hover:opacity-70" title="退出电台">
                <LogOut className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>
          )}

          {/* DJ 解说 */}
          {store.djScript && currentSong && (
            <DjCard script={store.djScript} isDark={isDark} chatInput={chatInput} isChatLoading={store.isChatLoading}
              djStyle={djStyle} onStyleChange={setDjStyle}
              onClose={() => store.setDjScript(null)} onChatInputChange={setChatInput} onQuickChat={handleDjQuickChat} variant="portrait" />
          )}

          {/* 歌词 */}
          {lyrics.length > 0 && currentSong && (
            <div className="w-full mt-6 rounded-2xl p-4 relative"
              style={{ background: 'var(--lyric-container-bg)', border: '1px solid var(--panel-border)', backdropFilter: 'blur(22px) saturate(1.4)' }}>
              <div className={`relative overflow-hidden transition-all duration-300 ${lyricsExpanded ? 'h-[360px]' : 'h-48'}`}>
                <div ref={lyricRef} className="h-full overflow-y-auto py-6 text-center">
                  {lyrics.map((line, i) => {
                    const translation = preferences.showTranslation ? findTranslation(translationMap, line.time) : null;
                    return (
                      <button key={i} onClick={() => seekToLyricTime(line.time)}
                        className="w-full py-2.5 px-4 transition-all duration-200 text-center rounded-lg hover:opacity-80"
                        aria-label={`跳转到 ${formatTime(line.time)} ${line.text}`}
                        style={{ fontSize: i === activeLyricIndex ? '15px' : '13px', fontWeight: i === activeLyricIndex ? 600 : 400, color: i === activeLyricIndex ? GOLD : 'var(--lyric-inactive)', letterSpacing: i === activeLyricIndex ? '0.02em' : '0' }}>
                        <span className="block">{line.text}</span>
                        {translation && (
                          <span className="block text-[10px] mt-0.5 font-normal opacity-70">{translation}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => setLyricsExpanded(!lyricsExpanded)}
                className="w-full pt-2 text-center text-[10px] font-medium transition-all"
                style={{ color: 'var(--text-tertiary)' }}>
                {lyricsExpanded ? '收起歌词' : '展开歌词'}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* 底部导航 */}
      <div className="flex-shrink-0 z-30 relative" style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(24px) saturate(1.3)' }}>
        <div className="flex items-center justify-around px-4 pt-3 pb-1">
          <button onClick={() => { setShowRadio(true); }} className="flex flex-col items-center gap-1 transition-all hover:scale-110 px-2 relative"
            style={{ color: store.radioMode === 'station' ? GOLD : 'var(--text-secondary)' }}>
            <Radio className="w-5 h-5" />
            <span className="text-[9px] font-medium">AI 电台</span>
            {store.radioMode === 'station' && (
              <span className="absolute top-0 right-1 w-1.5 h-1.5 rounded-full" style={{ background: GOLD, boxShadow: `0 0 6px ${GOLD}` }} />
            )}
          </button>
          <button onClick={() => { setMode('search'); setShowSearch(true); }} className="flex flex-col items-center gap-1 transition-all hover:scale-110 px-2"
            style={{ color: showSearch ? GOLD : 'var(--text-secondary)' }}>
            <Search className="w-5 h-5" /><span className="text-[9px] font-medium">AI 搜索</span>
          </button>
          <button onClick={() => { setShowChat(true); loadAiMemory(); }} className="flex flex-col items-center gap-1 transition-all hover:scale-110 px-2"
            style={{ color: showChat ? GOLD : 'var(--text-secondary)' }}>
            <Bot className="w-5 h-5" /><span className="text-[9px] font-medium">AI 助手</span>
          </button>
          <button onClick={() => setShowPlaylist(true)} className="flex flex-col items-center gap-1 transition-all hover:scale-110 px-2"
            style={{ color: showPlaylist ? GOLD : 'var(--text-secondary)' }}>
            <ListMusic className="w-5 h-5" /><span className="text-[9px] font-medium">列表</span>
          </button>
        </div>
        <div className="text-center pb-2"><span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>仅供学习与研究 · 禁止商用</span></div>
      </div>

      {/* ===== AI 搜索面板 ===== */}
      <SlidePanel show={showSearch} onClose={() => setShowSearch(false)} title={mode === 'search' ? 'AI 搜索 · 关键词' : 'AI 搜索 · 描述心情'} icon={mode === 'search' ? Search : Sparkles}>
        <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: 'var(--card-bg)' }}>
          {(['search', 'ai'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
              style={mode === m
                ? { background: GOLD, color: '#fff', boxShadow: '0 2px 8px rgba(201,169,110,0.35)' }
                : { background: 'transparent', color: 'var(--text-secondary)' }}>
              {m === 'search' ? '关键词' : 'AI 推荐'}
            </button>
          ))}
        </div>
        <div className="mb-3">
          <div className="flex items-center rounded-xl px-4 py-3" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
            {mode === 'search' ? <Search className="w-4 h-4 mr-3" style={{ color: 'var(--text-tertiary)' }} /> : <Sparkles className="w-4 h-4 mr-3" style={{ color: GOLD }} />}
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') mode === 'search' ? handleSearch() : handleAiRecommend(); }}
              placeholder={mode === 'search' ? '歌曲、歌手...' : '描述心情或场景...'} className="flex-1 bg-transparent outline-none text-sm min-w-0" style={{ color: 'var(--text-primary)' }} autoFocus />
          </div>
        </div>
        <div className="mb-3">
          <button onClick={mode === 'search' ? () => handleSearch() : () => handleAiRecommend(false)} disabled={store.isSearching || store.isRecommending}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-30 flex items-center justify-center gap-2"
            style={{ background: mode === 'ai' ? GOLD : 'var(--btn-secondary-bg)', color: mode === 'ai' ? '#000' : 'var(--btn-secondary-text)' }}>
            {store.isSearching || store.isRecommending ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'search' ? <><Search className="w-3.5 h-3.5" /> 搜索</> : <><Sparkles className="w-3.5 h-3.5" /> AI 推荐</>}
          </button>
        </div>
        {store.recommendation?.intro && mode === 'ai' && (
          <div className="mb-3 p-3 rounded-xl" style={{ background: 'rgba(201,169,110,0.05)', border: '1px solid rgba(201,169,110,0.08)' }}>
            <p className="text-[11px] font-medium mb-1" style={{ color: GOLD }}>{store.recommendation.mood}</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-icon)' }}>{store.recommendation.intro}</p>
          </div>
        )}
        {/* 加载骨架屏：三平台并行搜索常耗时数秒，结果区给出明确占位 */}
        {(store.isSearching || store.isRecommending) && (
          <div className="space-y-2 py-2" aria-label="正在加载结果">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl animate-pulse"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', opacity: 1 - i * 0.14 }}>
                <div className="w-11 h-11 rounded-lg flex-shrink-0" style={{ background: 'var(--hover-bg)' }} />
                <div className="flex-1 space-y-2">
                  <div className="h-2.5 rounded-full w-2/5" style={{ background: 'var(--hover-bg)' }} />
                  <div className="h-2 rounded-full w-1/4" style={{ background: 'var(--hover-bg)' }} />
                </div>
              </div>
            ))}
            <p className="text-[10px] text-center pt-1" style={{ color: 'var(--text-tertiary)' }}>
              {store.isRecommending ? 'AI 正在为你挑选歌曲…' : '正在检索三个音乐平台…'}
            </p>
          </div>
        )}
        {(mode === 'ai' ? store.aiRecommendSongs : store.searchResults).length === 0 && !store.isSearching && !store.isRecommending && (
          <div className="flex flex-col items-center py-6" style={{ color: 'var(--text-tertiary)' }}>
            {mode === 'search' && store.searchHistory.length > 0 ? (
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>最近搜索</span>
                  <button onClick={() => store.clearSearchHistory()} className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>清除</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {store.searchHistory.map((kw, i) => (
                    <button key={i} onClick={() => { setQuery(kw); handleSearch(kw); }}
                      className="text-[11px] px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                      style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            ) : mode === 'search' ? (
              <div className="w-full">
                <p className="text-[10px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>热门搜索</p>
                <div className="flex flex-wrap gap-1.5">
                  {['周杰伦', '陈奕迅', 'Taylor Swift', '薛之谦', '林俊杰', '邓紫棋', 'Adele', '五月天'].map((kw) => (
                    <button key={kw} onClick={() => { setQuery(kw); handleSearch(kw); }}
                      className="text-[11px] px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                      style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-full">
                <Sparkles className="w-8 h-8 mx-auto mb-3" style={{ color: GOLD, opacity: 0.5 }} />
                <p className="text-xs text-center mb-3" style={{ color: 'var(--text-secondary)' }}>
                  {new Date().getHours() < 6 ? '夜深了，来点助眠音乐？' :
                   new Date().getHours() < 10 ? '早安，用音乐开启新的一天' :
                   new Date().getHours() < 14 ? '午间休息，放松一下' :
                   new Date().getHours() < 18 ? '下午时光，需要什么氛围？' :
                   new Date().getHours() < 22 ? '晚间时光，听点什么好？' : '深夜电台，陪你到天亮'}
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {(new Date().getHours() < 6 ? ['轻柔的助眠钢琴曲', '雨声白噪音配乐', '安静的夜晚独处'] :
                    new Date().getHours() < 10 ? ['元气满满的早晨', '通勤路上的好心情', '清新的民谣开场'] :
                    new Date().getHours() < 14 ? ['午后咖啡时光', '轻松的爵士乐', '工作时的专注音乐'] :
                    new Date().getHours() < 18 ? ['下午茶的慵懒节奏', '运动跑步时的节奏', '开车兜风的歌单'] :
                    new Date().getHours() < 22 ? ['晚餐时的浪漫氛围', '怀旧经典老歌', '和朋友聚会的嗨歌'] :
                    ['深夜一个人静静听', '失眠夜的温柔陪伴', '回忆里的那些旋律']
                  ).concat(['最近很火的歌', '冷门但好听的宝藏', '治愈系音乐']).map((scene) => (
                    <button key={scene} onClick={() => { setQuery(scene); handleAiRecommend(false, scene); }}
                      className="text-[11px] px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                      style={{ background: 'rgba(201,169,110,0.06)', color: GOLD, border: '1px solid rgba(201,169,110,0.12)' }}>
                      {scene}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 根据 mode 显示对应的结果数据源，互不干扰 */}
        {(() => {
          const list = mode === 'ai' ? store.aiRecommendSongs : store.searchResults;
          const clearList = () => {
            if (mode === 'ai') { store.setAiRecommendSongs([]); store.setRecommendation(null); }
            else { store.setSearchResults([]); }
          };
          if (list.length === 0) return null;
          return (
            <>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {mode === 'ai' ? `AI 推荐结果 ${list.length} 首` : `搜索结果 ${list.length} 首`}
                </span>
                <button onClick={clearList}
                  className="text-[10px] px-2 py-0.5 rounded transition-all hover:opacity-70"
                  style={{ color: 'var(--text-secondary)', background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>清空结果</button>
              </div>
              {list.map((song, i) => {
                // AI 推荐模式下，把后端生成的「为什么推这首」带到列表副标题
                const reason = mode === 'ai'
                  ? store.recommendation?.songs?.find((r) =>
                      r.name === song.name || song.name.includes(r.name) || r.name.includes(song.name)
                    )?.reason
                  : undefined;
                return (
                  <SongRow key={song.id + '-' + i} song={song} index={i} isDark={isDark} reason={reason}
                    onPlay={(s) => handlePlaySong(s, 'search', list)} onAdd={(s) => { store.addToPlaylist(s); showToast('已添加', 'success'); }} onClosePanel={closeAllPanels} />
                );
              })}
            </>
          );
        })()}
      </SlidePanel>

      {/* ===== 播放列表 ===== */}
      <SlidePanel show={showPlaylist} onClose={() => setShowPlaylist(false)} title="播放列表" icon={ListMusic}
        action={store.playlist.length > 0 ? <ClearButton onClick={() => { store.clearPlaylist(); showToast('已清空', 'info'); }} /> : undefined}>
        {store.playlist.length === 0 ? (
          <div className="flex flex-col items-center py-12" style={{ color: 'var(--text-tertiary)' }}><ListMusic className="w-10 h-10 mb-3" /><p className="text-xs">播放列表为空</p></div>
        ) : store.playlist.map((song, i) => (
          <div key={`${song.id}-${i}`} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1"
            style={{ background: currentSong?.id === song.id ? 'rgba(201,169,110,0.06)' : 'transparent', border: `1px solid ${currentSong?.id === song.id ? 'rgba(201,169,110,0.1)' : 'transparent'}` }}
            onMouseEnter={(e) => { if (currentSong?.id !== song.id) { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)'; }}}
            onMouseLeave={(e) => { if (currentSong?.id !== song.id) { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}}
            onClick={() => handlePlaySong(song, 'playlist', store.playlist)}>
            <span className="text-[10px] font-medium w-5 text-center flex-shrink-0" style={{ color: currentSong?.id === song.id ? GOLD : 'var(--text-tertiary)' }}>
              {currentSong?.id === song.id && isPlaying ? (
                <span className="inline-flex gap-[2px] items-end h-3">
                  <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '60%' }} />
                  <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '100%', animationDelay: '0.1s' }} />
                  <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '75%', animationDelay: '0.2s' }} />
                </span>
              ) : (i + 1)}
            </span>
            {song.cover ? <img src={song.cover} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : (
              <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--card-bg)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: currentSong?.id === song.id ? GOLD : 'var(--text-primary)' }}>{song.name}</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{song.artist}</p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); store.removeFromPlaylist(i); }} className="p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100" style={{ background: 'var(--hover-bg)' }}>
              <Trash2 className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>
        ))}
      </SlidePanel>

      {/* ===== AI 电台 ===== */}
      <SlidePanel show={showRadio} onClose={() => setShowRadio(false)} title="AI 电台" icon={Radio}>
        <AIRadioPanel
          isDark={isDark}
          isLoading={isRadioStarting}
          customInput={radioCustomInput}
          onCustomInputChange={setRadioCustomInput}
          onStart={(style, preset) => { handleStartRadio(style, preset); setShowRadio(false); }}
          onExit={() => { handleExitRadio(); }}
        />
      </SlidePanel>

      {/* ===== 收藏 ===== */}
      <SlidePanel show={showFavorites} onClose={() => setShowFavorites(false)} title="我的收藏" icon={Heart}
        action={store.favorites.length > 0 ? <ClearButton onClick={() => { store.clearFavorites(); showToast('收藏已清空', 'info'); }} /> : undefined}>
        {store.favorites.length === 0 ? (
          <div className="flex flex-col items-center py-12" style={{ color: 'var(--text-tertiary)' }}>
            <Heart className="w-10 h-10 mb-3" /><p className="text-xs">暂无收藏歌曲</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>点击播放页心形图标收藏</p>
          </div>
        ) : store.favorites.map((song, i) => (
          <SongRow key={song.id + '-' + i} song={song} index={i} isDark={isDark} showRemove onRemove={() => store.removeFromFavorites(song.id)}
            onPlay={(s) => handlePlaySong(s, 'favorites', store.favorites)} onAdd={(s) => { store.addToPlaylist(s); showToast('已添加', 'success'); }} onClosePanel={closeAllPanels} />
        ))}
      </SlidePanel>

      {/* ===== 历史 ===== */}
      <SlidePanel show={showHistory} onClose={() => setShowHistory(false)} title="最近播放" icon={History}
        action={store.playHistory.length > 0 ? <ClearButton onClick={() => { store.clearHistory(); showToast('历史已清空', 'info'); }} /> : undefined}>
        {store.playHistory.length === 0 ? (
          <div className="flex flex-col items-center py-12" style={{ color: 'var(--text-tertiary)' }}><History className="w-10 h-10 mb-3" /><p className="text-xs">暂无播放记录</p></div>
        ) : store.playHistory.map((song, i) => (
          <SongRow key={song.id + '-' + i} song={song} index={i} isDark={isDark}
            onPlay={(s) => handlePlaySong(s, 'history', store.playHistory)} onAdd={(s) => { store.addToPlaylist(s); showToast('已添加', 'success'); }} onClosePanel={closeAllPanels} />
        ))}
      </SlidePanel>

      {/* ===== AI 聊天 ===== */}
      <SlidePanel show={showChat} onClose={() => setShowChat(false)} title="AI 音乐助手" icon={Bot}
        action={store.chatMessages.length > 0 ? <ClearButton onClick={() => { store.clearChat(); showToast('对话已清空', 'info'); }} /> : undefined}
        footer={(
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--input-border)' }}>
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleChatSend(); }}
              placeholder="聊点音乐..." className="flex-1 bg-transparent outline-none text-[13px] min-w-0" style={{ color: 'var(--text-primary)' }} disabled={store.isChatLoading} />
            <button onClick={handleChatSend} disabled={!chatInput.trim() || store.isChatLoading} className="p-1.5 rounded-lg transition-all disabled:opacity-30" style={{ background: 'rgba(201,169,110,0.15)' }}>
              <Send className="w-3.5 h-3.5" style={{ color: GOLD }} />
            </button>
          </div>
        )}>
        {aiMemory.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {aiMemory.map((mem, i) => {
              const isNeg = mem.polarity === 'negative';
              const tag = (mem.label || '').split('·').pop() || mem.label;
              const clickable = !isNeg && (mem.category === 'artist' || mem.category === 'song' || mem.category === 'genre' || mem.category === 'mood' || mem.category === 'scene');
              const handleClick = () => {
                if (!clickable) return;
                if (mem.category === 'song') {
                  handleChatPlayIntent(tag, '');
                } else if (mem.category === 'artist') {
                  handleChatRecommendIntent(`推荐 ${tag} 的代表作`);
                } else {
                  handleChatRecommendIntent(`推荐 ${tag} 风格/情绪的经典歌`);
                }
              };
              return (
                <span key={mem.key || i} className="inline-flex items-center rounded-full transition-all"
                  style={{
                    background: isNeg
                      ? (isDark ? 'rgba(200,80,80,0.12)' : 'rgba(200,60,60,0.1)')
                      : (isDark ? 'rgba(201,169,110,0.15)' : 'rgba(201,169,110,0.2)'),
                    border: `1px solid ${isNeg
                      ? (isDark ? 'rgba(200,80,80,0.25)' : 'rgba(200,60,60,0.3)')
                      : (isDark ? 'rgba(201,169,110,0.3)' : 'rgba(201,169,110,0.4)')}`,
                  }}>
                  <button type="button" onClick={handleClick}
                    className={`text-[12px] pl-2.5 py-1 rounded-full transition-all ${clickable ? 'cursor-pointer hover:opacity-80 hover:scale-105' : 'cursor-default'}`}
                    style={{
                      color: isNeg
                        ? (isDark ? 'rgba(255,120,120,0.95)' : 'rgba(180,40,40,0.95)')
                        : (isDark ? 'rgba(220,190,130,0.95)' : 'rgba(130,100,40,0.95)'),
                    }}
                    aria-label={`记忆标签 ${mem.label}`}>{mem.label}</button>
                  <button type="button" onClick={() => deleteAiMemory(mem.key)}
                    className="px-1.5 py-1 rounded-full opacity-60 hover:opacity-100"
                    aria-label={`删除记忆 ${mem.label}`} title="删除这条记忆">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {store.chatMessages.length === 0 ? (
          <div className="flex flex-col items-center py-10" style={{ color: 'var(--text-tertiary)' }}>
            <Bot className="w-10 h-10 mb-3" /><p className="text-xs">你的私人音乐助手</p>
            <p className="text-[10px] mt-2 text-center leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>问我关于音乐的一切<br />我会记住你的喜好，越聊越懂你</p>
          </div>
        ) : (
          <div ref={chatScrollRef} className="flex flex-col gap-3 pb-2">
            {store.chatMessages.map((msg, i) => (
              <div key={i} className={`group flex items-center gap-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <button onClick={() => store.deleteChatMessage(i)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" style={{ color: 'var(--text-tertiary)' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5"
                  style={msg.role === 'user' ? { background: 'rgba(201,169,110,0.15)', border: '1px solid rgba(201,169,110,0.2)', color: 'var(--text-primary)' } : { background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)' }}>
                  {msg.role === 'assistant' ? (
                    <ChatMessageRenderer content={msg.content} isDark={isDark}
                      onPlaySong={handleChatPlayIntent}
                      onPlayBatch={handleChatBatchPlay}
                      onRecommend={handleChatRecommendIntent}
                      onOpenPanel={handleChatOpenPanel} />
                  ) : (
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <button onClick={() => store.deleteChatMessage(i)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" style={{ color: 'var(--text-tertiary)' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {store.isChatLoading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                  <span className="inline-flex gap-1 items-center h-5">
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GOLD, animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GOLD, animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: GOLD, animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={lastMsgRef} />
          </div>
        )}
      </SlidePanel>
    </div>
      )}
    </>
  );
}
