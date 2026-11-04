import { useRef, useEffect, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Search, Sparkles, ListMusic, X, Minus,
  Headphones, Mic2, Music, Loader2, Heart, History,
  Clock, Bot, Send, Minimize2, Sun, Moon, Trash2, Shuffle, Repeat, Repeat1, ThumbsDown, Radio, LogOut, Settings
} from 'lucide-react';
import type { Song } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import Toast from '../Toast';
import SongRow from './SongRow';
import DjCard from './DjCard';
import ChatMessageRenderer from './ChatMessageRenderer';
import AIRadioPanel from './AIRadioPanel';
import { GOLD, formatTime, parseLyric, mergeLyricTranslation, findTranslation } from './utils';
import ConfirmClearButton from './ConfirmClearButton';

interface LandscapeLayoutProps {
  // 状态
  isDark: boolean;
  ttsEnabled: boolean;
  djStyle: 'night' | 'energy' | 'literary';
  fsPanel: 'none' | 'search' | 'playlist' | 'favorites' | 'history' | 'chat' | 'radio';
  mode: 'search' | 'ai';
  query: string;
  chatInput: string;
  aiMemory: { label: string; category?: string; polarity?: 'positive' | 'negative' }[];
  toast: { message: string; type: 'error' | 'success' | 'info' } | null;
  radioCustomInput: string;
  isRadioStarting: boolean;
  // 操作
  setIsFullscreen: (v: boolean) => void;
  setTtsEnabled: (v: boolean) => void;
  setDjStyle: (v: 'night' | 'energy' | 'literary') => void;
  setFsPanel: (v: 'none' | 'search' | 'playlist' | 'favorites' | 'history' | 'chat' | 'radio') => void;
  setMode: (v: 'search' | 'ai') => void;
  setQuery: (v: string) => void;
  setChatInput: (v: string) => void;
  setToast: (v: { message: string; type: 'error' | 'success' | 'info' } | null) => void;
  setRadioCustomInput: (v: string) => void;
  toggleTheme: () => void;
  onOpenSettings?: () => void;
  showTranslation?: boolean;
  handleSearch: (keyword?: string) => void;
  handleAiRecommend: (autoMode?: boolean, promptOverride?: string) => void;
  handlePlaySong: (song: Song, source?: 'playlist' | 'favorites' | 'history' | 'search', sourceList?: Song[]) => void;
  handleChatSend: () => void;
  handleDjQuickChat: () => void;
  feedbackToAi?: (action: 'favorite' | 'unfavorite' | 'skip' | 'play_complete' | 'dislike', song: Song | null) => void;
  onChatPlayIntent?: (name: string, artist: string) => void;
  onChatBatchPlay?: (items: { song: string; artist: string }[]) => void;
  onChatRecommendIntent?: (prompt: string) => void;
  onChatOpenPanel?: (panel: string) => void;
  onStartRadio: (style: string, preset: string | null) => void;
  onExitRadio: () => void;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
}

export default function LandscapeLayout(props: LandscapeLayoutProps) {
  const {
    isDark, ttsEnabled, djStyle, fsPanel, mode, query, chatInput, aiMemory, toast,
    radioCustomInput, isRadioStarting,
    setIsFullscreen, setTtsEnabled, setDjStyle, setFsPanel, setMode, setQuery, setChatInput, setToast,
    setRadioCustomInput,
    toggleTheme, onOpenSettings, showTranslation, handleSearch, handleAiRecommend, handlePlaySong, handleChatSend, handleDjQuickChat, showToast, feedbackToAi,
    onChatPlayIntent, onChatBatchPlay, onChatRecommendIntent, onChatOpenPanel, onStartRadio, onExitRadio,
  } = props;

  // 性能优化：useShallow 拆分订阅，currentTime/duration 高频字段独立
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
    djScript: s.djScript,
    favorites: s.favorites,
    playHistory: s.playHistory,
    chatMessages: s.chatMessages,
    isChatLoading: s.isChatLoading,
    searchHistory: s.searchHistory,
    playMode: s.playMode,
    setIsPlaying: s.setIsPlaying,
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
    radioMode: s.radioMode,
    radioStylePreset: s.radioStylePreset,
    radioStyle: s.radioStyle,
  })));
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const lyricRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const currentSong = store.currentSong;
  const isPlaying = store.isPlaying;
  // 性能优化：parseLyric 仅在 lyric 变化时重新解析（之前每秒 re-render 都跑一次）
  const fsLyrics = useMemo(() => parseLyric(store.lyric), [store.lyric]);
  const fsTranslationMap = useMemo(() => mergeLyricTranslation(store.tlyric), [store.tlyric]);
  // LRC 时间戳普遍略晚于实际演唱 200-400ms（采集精度问题）：用 +0.3s 预读补偿
  const LYRIC_LEAD_MS = 0.3;
  const fsActiveLyricIndex = fsLyrics.findIndex((l, i) => {
    const next = fsLyrics[i + 1];
    const t = currentTime + LYRIC_LEAD_MS;
    return t >= l.time && (!next || t < next.time);
  });
  const fsProgressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 歌词滚动：改为 auto（瞬间到位）+ rAF 等 DOM 稳定后再滚，与字体高亮过渡视觉协同
  useEffect(() => {
    if (!lyricRef.current || fsActiveLyricIndex < 0) return;
    const el = lyricRef.current.children[fsActiveLyricIndex] as HTMLElement | undefined;
    if (!el) return;
    requestAnimationFrame(() => {
      // 用 scrollTop 直接计算位置，比 scrollIntoView 更可控（不被祖先 overflow 影响）
      const container = lyricRef.current;
      if (!container) return;
      const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    });
  }, [fsActiveLyricIndex]);

  // 聊天自动滚底
  // 聊天自动滚底（横版 chatScrollRef 是真实的 overflow-y-auto 容器）
  const lastChatContent = store.chatMessages[store.chatMessages.length - 1]?.content || '';
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [store.chatMessages.length, lastChatContent, store.isChatLoading, fsPanel]);

  const T = {
    bgFs: 'var(--bg-gradient-fs)',
    text: 'var(--text-primary)',
    textSec: 'var(--text-secondary)',
    textTer: 'var(--text-tertiary)',
    card: 'var(--card-bg)',
    cardBorder: 'var(--card-border)',
    sidebarBg: 'var(--sidebar-bg)',
    panelBg: 'var(--fs-panel-bg)',
  };

  const renderSongRow = (song: Song, opts: { showRemove?: boolean; onRemove?: () => void; index: number; source?: 'playlist' | 'favorites' | 'history' | 'search'; sourceList?: Song[] }) => (
    <SongRow key={song.id + '-' + opts.index} song={song} index={opts.index} isDark={isDark}
      showRemove={opts.showRemove} onRemove={opts.onRemove}
      onPlay={(s) => {
        handlePlaySong(s, opts.source, opts.sourceList);
      }} onAdd={(s) => { store.addToPlaylist(s); showToast('已添加', 'success'); }} />
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden relative"
      style={{ background: T.bgFs, color: T.text }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {currentSong?.cover && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <img src={currentSong.cover} alt="" className="w-full h-full object-cover opacity-[0.05] blur-[100px] scale-150" />
        </div>
      )}
      {/* 顶部菜单栏 */}
      <div className="flex-shrink-0 h-10 flex items-center px-4 relative z-50"
        style={{ ['WebkitAppRegion' as string]: 'drag' }}>
        {/* macOS 红绿灯 */}
        <div className="flex items-center gap-2 mr-4" style={{ ['WebkitAppRegion' as string]: 'no-drag' }}>
          <button onClick={() => { if ((window as any).electronAPI?.close) (window as any).electronAPI.close(); }}
            className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group"
            style={{ background: '#ff5f57' }}>
            <X className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#4a0002' }} />
          </button>
          <button onClick={() => { if ((window as any).electronAPI?.minimize) (window as any).electronAPI.minimize(); }}
            className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group"
            style={{ background: '#febc2e' }}>
            <Minus className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#985700' }} />
          </button>
          <button onClick={async () => {
            if ((window as any).electronAPI?.toggleFullscreen) {
              const fs = await (window as any).electronAPI.toggleFullscreen();
              setIsFullscreen(fs);
            } else {
              setIsFullscreen(false);
            }
          }}
            className="w-3 h-3 rounded-full transition-all hover:brightness-110 flex items-center justify-center group"
            style={{ background: '#28c840' }}>
            <Minimize2 className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#006500' }} />
          </button>
        </div>
        <div className="flex-1" />
        {/* 品牌字标居中 */}
        <span className="text-sm font-bold tracking-tight"
          style={isDark
            ? { color: '#ffffff' }
            : {
                background: 'linear-gradient(90deg, #1a2744 0%, #1a2744 50%, #4A7CFF 51%, #A855F7 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
          MusicBuddy
        </span>
        <div className="flex-1" />
      </div>
      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden relative">

      {/* 侧边导航栏 */}
      <div className="w-14 flex-shrink-0 flex flex-col items-center pt-4 pb-4 gap-0.5 z-20"
        style={{ background: T.sidebarBg, borderRight: `1px solid ${T.cardBorder}` }}>
        {/* 品牌图标 */}
        <div className="w-11 h-11 flex items-center justify-center mb-2">
          <img src="./icons/icon-32.png" alt="" className="w-7 h-7 rounded-md" />
        </div>
        {[
          { icon: Radio, label: 'AI电台', key: 'radio' as const, accent: true },
          { icon: Search, label: 'AI搜索', key: 'search' as const, accent: true },
          { icon: Bot, label: 'AI助手', key: 'chat' as const, accent: true },
          { icon: ListMusic, label: '列表', key: 'playlist' as const },
          { icon: Heart, label: '收藏', key: 'favorites' as const },
          { icon: Clock, label: '历史', key: 'history' as const },
        ].map(({ icon: NavIcon, label, key, accent }) => {
          const active = fsPanel === key;
          // AI 电台在电台模式下额外亮金色徽标
          const stationActive = key === 'radio' && store.radioMode === 'station';
          return (
            <button key={key}
              onClick={() => {
                if (key === 'search' && fsPanel !== 'search') { setMode('search'); }
                setFsPanel(fsPanel === key ? 'none' : key);
              }}
              className="w-11 h-11 flex flex-col items-center justify-center rounded-lg transition-all relative"
              style={active || stationActive
                ? { background: 'rgba(201,169,110,0.15)', color: GOLD, fontWeight: 600 }
                : { color: 'var(--text-secondary)' }}>
              <NavIcon className="w-4 h-4" />
              <span className="text-[9px] mt-0.5 leading-none font-medium">{label}</span>
              {stationActive && !active && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
              )}
              {/* accent 占位（保留 prop 兼容） */}
              {accent ? null : null}
            </button>
          );
        })}
        <div className="flex-1" />
        {/* 主题切换 */}
        <button onClick={toggleTheme} className="w-11 h-11 flex items-center justify-center rounded-lg transition-all hover:opacity-70"
          style={{ color: 'var(--text-secondary)' }} aria-label="切换主题">
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {/* 设置 */}
        <button onClick={onOpenSettings} className="w-11 h-11 flex items-center justify-center rounded-lg transition-all hover:opacity-70"
          style={{ color: 'var(--text-secondary)' }} aria-label="打开设置" title="设置">
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* 功能面板 */}
      {fsPanel !== 'none' && (
        <div className="flex-shrink-0 flex flex-col z-10 overflow-hidden" style={{ width: '380px', background: T.panelBg, borderRight: `1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between px-4 pt-10 pb-2 flex-shrink-0">
            <span className="text-xs font-semibold" style={{ color: T.textSec }}>
              {fsPanel === 'radio' ? 'AI 电台' : fsPanel === 'search' ? (mode === 'search' ? 'AI 搜索 · 关键词' : 'AI 搜索 · 描述心情') : fsPanel === 'playlist' ? '播放列表' : fsPanel === 'favorites' ? '收藏' : fsPanel === 'history' ? '历史' : 'AI 助手'}
            </span>
            <div className="flex items-center gap-2">
              {fsPanel === 'chat' && store.chatMessages.length > 0 && (
                <ConfirmClearButton onClick={() => { store.clearChat(); showToast('对话已清空', 'info'); }} className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all" />
              )}
              {fsPanel === 'playlist' && store.playlist.length > 0 && (
                <ConfirmClearButton onClick={() => { store.clearPlaylist(); showToast('已清空', 'info'); }} className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all" />
              )}
              {fsPanel === 'favorites' && store.favorites.length > 0 && (
                <ConfirmClearButton onClick={() => { store.clearFavorites(); showToast('收藏已清空', 'info'); }} className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all" />
              )}
              {fsPanel === 'history' && store.playHistory.length > 0 && (
                <ConfirmClearButton onClick={() => { store.clearHistory(); showToast('历史已清空', 'info'); }} className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all" />
              )}
              <button onClick={() => setFsPanel('none')} className="p-1 rounded-full" style={{ background: 'var(--card-bg)' }}>
                <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>
          </div>
          {fsPanel === 'radio' ? (
            <AIRadioPanel
              isDark={isDark}
              isLoading={isRadioStarting}
              customInput={radioCustomInput}
              onCustomInputChange={setRadioCustomInput}
              onStart={onStartRadio}
              onExit={onExitRadio}
            />
          ) : fsPanel === 'chat' ? (
            <div className="flex-1 flex flex-col overflow-hidden px-4 pb-4">
              {aiMemory.length > 0 && (<div className="flex flex-wrap gap-1.5 mb-2 pb-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--panel-border)' }}>{aiMemory.map((m, i) => {
                const isNeg = m.polarity === 'negative';
                const tag = (m.label || '').split('·').pop() || m.label;
                const clickable = !isNeg && (m.category === 'artist' || m.category === 'song' || m.category === 'genre' || m.category === 'mood' || m.category === 'scene');
                const handleClick = () => {
                  if (!clickable) return;
                  if (m.category === 'song') {
                    onChatPlayIntent?.(tag, '');
                  } else if (m.category === 'artist') {
                    onChatRecommendIntent?.(`推荐 ${tag} 的代表作`);
                  } else {
                    onChatRecommendIntent?.(`推荐 ${tag} 风格/情绪的经典歌`);
                  }
                };
                return (
                  <span key={i} onClick={handleClick}
                    className={`text-[11px] px-2 py-0.5 rounded-full transition-all ${clickable ? 'cursor-pointer hover:opacity-80 hover:scale-105' : ''}`}
                    style={{
                      background: isNeg ? (isDark ? 'rgba(200,80,80,0.12)' : 'rgba(200,60,60,0.1)') : (isDark ? 'rgba(201,169,110,0.15)' : 'rgba(201,169,110,0.2)'),
                      color: isNeg ? (isDark ? 'rgba(255,120,120,0.95)' : 'rgba(180,40,40,0.95)') : (isDark ? 'rgba(220,190,130,0.95)' : 'rgba(130,100,40,0.95)'),
                      border: `1px solid ${isNeg ? (isDark ? 'rgba(200,80,80,0.25)' : 'rgba(200,60,60,0.3)') : (isDark ? 'rgba(201,169,110,0.3)' : 'rgba(201,169,110,0.4)')}`,
                    }}>{m.label}</span>
                );
              })}</div>)}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-2 mb-3 min-h-0">
                {store.chatMessages.map((msg, i) => (
                  <div key={i} className={`group flex items-center gap-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <button onClick={() => store.deleteChatMessage(i)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" style={{ color: 'var(--text-tertiary)' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    <div className="max-w-[85%] px-3 py-2 rounded-xl" style={msg.role === 'user' ? { background: 'rgba(201,169,110,0.1)', color: 'var(--text-primary)' } : { background: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>
                      {msg.role === 'assistant' ? (
                        <ChatMessageRenderer content={msg.content} isDark={isDark}
                          onPlaySong={(n, a) => onChatPlayIntent?.(n, a)}
                          onPlayBatch={(items) => onChatBatchPlay?.(items)}
                          onRecommend={(p) => onChatRecommendIntent?.(p)}
                          onOpenPanel={(p) => onChatOpenPanel?.(p)}
                          variant="landscape" />
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
                {store.isChatLoading && <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>思考中...</div>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleChatSend(); }} placeholder="聊聊音乐..." className="flex-1 bg-transparent outline-none text-[13px] px-3 py-2 rounded-lg" style={{ background: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }} />
                <button onClick={handleChatSend} disabled={store.isChatLoading || !chatInput.trim()} className="p-1.5 rounded-lg disabled:opacity-30" style={{ background: GOLD }}><Send className="w-3.5 h-3.5 text-black" /></button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {fsPanel === 'search' && (<>
                <div className="flex gap-1 mb-2 p-0.5 rounded-lg" style={{ background: 'var(--card-bg)' }}>{(['search', 'ai'] as const).map((m) => (<button key={m} onClick={() => setMode(m)} className="flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all" style={mode === m ? { background: GOLD, color: '#fff' } : { background: 'transparent', color: 'var(--text-secondary)' }}>{m === 'search' ? '关键词' : 'AI 推荐'}</button>))}</div>
                <div className="flex items-center rounded-lg px-3 py-2 mb-2" style={{ background: 'var(--hover-bg)', border: '1px solid var(--input-border)' }}>
                  {mode === 'search' ? <Search className="w-3.5 h-3.5 mr-2" style={{ color: 'var(--text-tertiary)' }} /> : <Sparkles className="w-3.5 h-3.5 mr-2" style={{ color: GOLD }} />}
                  <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') mode === 'search' ? handleSearch() : handleAiRecommend(); }} placeholder={mode === 'search' ? '歌曲、歌手...' : '描述心情...'} className="flex-1 bg-transparent outline-none text-[11px]" style={{ color: 'var(--text-primary)' }} autoFocus />
                </div>
                <button onClick={mode === 'search' ? () => handleSearch() : () => handleAiRecommend(false)} disabled={store.isSearching || store.isRecommending} className="w-full py-2 rounded-lg text-[11px] font-semibold mb-2 flex items-center justify-center gap-1 disabled:opacity-30" style={{ background: mode === 'ai' ? GOLD : 'var(--btn-secondary-bg)', color: mode === 'ai' ? '#000' : 'var(--btn-secondary-text)' }}>
                  {store.isSearching || store.isRecommending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === 'search' ? <><Search className="w-3 h-3" /> 搜索</> : <><Sparkles className="w-3 h-3" /> AI 推荐</>}
                </button>
                {store.recommendation?.intro && mode === 'ai' && (<div className="mb-2 p-2 rounded-lg" style={{ background: 'rgba(201,169,110,0.03)', border: '1px solid rgba(201,169,110,0.05)' }}><p className="text-[9px] font-medium" style={{ color: GOLD }}>{store.recommendation.mood}</p><p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{store.recommendation.intro}</p></div>)}
                {(mode === 'ai' ? store.aiRecommendSongs : store.searchResults).length === 0 && !store.isSearching && !store.isRecommending && (
                  <div className="py-4">
                    {mode === 'search' && store.searchHistory.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] font-medium" style={{ color: 'var(--text-secondary)' }}>最近搜索</span>
                          <button onClick={() => store.clearSearchHistory()} className="text-[8px]" style={{ color: 'var(--text-tertiary)' }}>清除</button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {store.searchHistory.map((kw, i) => (
                            <button key={i} onClick={() => { setQuery(kw); handleSearch(kw); }}
                              className="text-[10px] px-2.5 py-1 rounded-full hover:opacity-80"
                              style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>{kw}</button>
                          ))}
                        </div>
                      </div>
                    ) : mode === 'search' ? (
                      <div>
                        <p className="text-[9px] font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>热门搜索</p>
                        <div className="flex flex-wrap gap-1">
                          {['周杰伦', '陈奕迅', 'Taylor Swift', '薛之谦', '林俊杰', '邓紫棋', 'Adele', '五月天'].map((kw) => (
                            <button key={kw} onClick={() => { setQuery(kw); handleSearch(kw); }}
                              className="text-[10px] px-2.5 py-1 rounded-full hover:opacity-80"
                              style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>{kw}</button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Sparkles className="w-6 h-6 mx-auto mb-2" style={{ color: GOLD, opacity: 0.5 }} />
                        <p className="text-[10px] mb-2" style={{ color: 'var(--text-secondary)' }}>
                          {new Date().getHours() < 6 ? '夜深了，来点助眠音乐？' :
                           new Date().getHours() < 10 ? '早安，用音乐开启新的一天' :
                           new Date().getHours() < 14 ? '午间休息，放松一下' :
                           new Date().getHours() < 18 ? '下午时光，需要什么氛围？' :
                           new Date().getHours() < 22 ? '晚间时光，听点什么好？' : '深夜电台，陪你到天亮'}
                        </p>
                        <div className="flex flex-wrap gap-1 justify-center">
                          {(new Date().getHours() < 6 ? ['轻柔的助眠钢琴曲', '雨声白噪音配乐', '安静的夜晚独处'] :
                            new Date().getHours() < 10 ? ['元气满满的早晨', '通勤路上的好心情', '清新的民谣开场'] :
                            new Date().getHours() < 14 ? ['午后咖啡时光', '轻松的爵士乐', '工作时的专注音乐'] :
                            new Date().getHours() < 18 ? ['下午茶的慵懒节奏', '运动跑步时的节奏', '开车兜风的歌单'] :
                            new Date().getHours() < 22 ? ['晚餐时的浪漫氛围', '怀旧经典老歌', '和朋友聚会的嗨歌'] :
                            ['深夜一个人静静听', '失眠夜的温柔陪伴', '回忆里的那些旋律']
                          ).concat(['最近很火的歌', '冷门但好听的宝藏']).map((scene) => (
                            <button key={scene} onClick={() => { setQuery(scene); handleAiRecommend(false, scene); }}
                              className="text-[10px] px-2.5 py-1 rounded-full hover:opacity-80"
                              style={{ background: 'rgba(201,169,110,0.06)', color: GOLD, border: '1px solid rgba(201,169,110,0.12)' }}>{scene}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  const list = mode === 'ai' ? store.aiRecommendSongs : store.searchResults;
                  const clearList = () => {
                    if (mode === 'ai') { store.setAiRecommendSongs([]); store.setRecommendation(null); }
                    else { store.setSearchResults([]); }
                  };
                  if (list.length === 0) return null;
                  return (
                    <>
                      <div className="flex items-center justify-between mb-1.5 px-0.5">
                        <span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
                          {mode === 'ai' ? `AI 推荐 ${list.length} 首` : `搜索结果 ${list.length} 首`}
                        </span>
                        <button onClick={clearList}
                          className="text-[9px] px-1.5 py-0.5 rounded hover:opacity-70"
                          style={{ color: 'var(--text-secondary)', background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>清空</button>
                      </div>
                      {list.map((song, i) => renderSongRow(song, { index: i, source: 'search', sourceList: list }))}
                    </>
                  );
                })()}
              </>)}
              {fsPanel === 'playlist' && (<>{store.playlist.length === 0 ? <div className="text-center py-10" style={{ color: 'var(--text-tertiary)' }}><ListMusic className="w-8 h-8 mx-auto mb-2" /><p className="text-xs">播放列表为空</p><p className="text-[10px] mt-1">试试搜索一首歌吧</p></div> : store.playlist.map((song, i) => renderSongRow(song, { showRemove: true, onRemove: () => store.removeFromPlaylist(i), index: i, source: 'playlist', sourceList: store.playlist }))}</>)}
              {fsPanel === 'favorites' && (<>{store.favorites.length === 0 ? <div className="text-center py-10" style={{ color: 'var(--text-tertiary)' }}><Heart className="w-8 h-8 mx-auto mb-2" /><p className="text-xs">暂无收藏歌曲</p><p className="text-[10px] mt-1">点击播放页心形图标收藏</p></div> : store.favorites.map((song, i) => renderSongRow(song, { showRemove: true, onRemove: () => { store.removeFromFavorites(song.id); showToast('已取消', 'info'); }, index: i, source: 'favorites', sourceList: store.favorites }))}</>)}
              {fsPanel === 'history' && (<>{store.playHistory.length === 0 ? <div className="text-center py-10" style={{ color: 'var(--text-tertiary)' }}><History className="w-8 h-8 mx-auto mb-2" /><p className="text-xs">暂无播放记录</p><p className="text-[10px] mt-1">歌曲播完后会自动记录</p></div> : store.playHistory.map((song, i) => renderSongRow(song, { index: i, source: 'history', sourceList: store.playHistory }))}</>)}
            </div>
          )}
        </div>
      )}

      {/* 播放区（可滚动） */}
      <div className="flex-1 flex flex-col items-center px-10 z-10 relative min-w-0 overflow-y-auto py-8">
        {currentSong ? (
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-2xl blur-3xl opacity-15" style={{ background: GOLD, transform: 'scale(0.65)' }} />
            <div className={`relative w-52 h-52 rounded-2xl overflow-hidden ${isPlaying ? 'animate-float' : ''}`} style={{ boxShadow: 'var(--cover-shadow)' }}>
              {currentSong.cover ? <img src={currentSong.cover} alt="" className={`w-full h-full object-cover ${isPlaying ? 'scale-105' : ''} transition-transform duration-1000`} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--card-bg)' }}><Music className="w-12 h-12" style={{ color: 'var(--card-bg)' }} /></div>}
            </div>
          </div>
        ) : (<div className="w-52 h-52 rounded-2xl flex items-center justify-center mb-6" style={{ background: 'var(--hover-bg)' }}><Headphones className="w-14 h-14" style={{ color: 'var(--hover-border)' }} /></div>)}
        <div className="text-center w-full max-w-sm">
          <h2 className="text-2xl font-bold truncate" style={{ color: T.text }}>{currentSong?.name || '选择一首歌曲'}</h2>
          <p className="text-sm mt-1.5" style={{ color: T.textSec }}>{currentSong?.artist || '搜索或让 AI 推荐'}</p>
          {currentSong?.platform && (<div className="flex items-center justify-center gap-1.5 mt-2"><span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: currentSong.platform === 'youtube' ? 'rgba(255,0,0,0.1)' : currentSong.platform === 'qq' ? 'rgba(201,169,110,0.1)' : 'rgba(100,149,237,0.1)', color: currentSong.platform === 'youtube' ? 'rgba(255,80,80,0.8)' : currentSong.platform === 'qq' ? 'rgba(201,169,110,0.8)' : 'rgba(100,149,237,0.8)' }}>{currentSong.platformName || currentSong.platform}</span><span className="text-[10px] px-2 py-0.5 rounded-full" style={currentSong.fee === 1 ? { background: isDark ? 'rgba(255,100,100,0.1)' : 'rgba(220,50,50,0.08)', color: isDark ? 'rgba(255,120,120,0.75)' : 'rgba(200,50,50,0.7)' } : { background: isDark ? 'rgba(100,255,100,0.07)' : 'rgba(30,160,60,0.06)', color: isDark ? 'rgba(100,255,100,0.65)' : 'rgba(30,140,50,0.7)' }}>{currentSong.fee === 1 ? '试听' : '免费'}</span></div>)}
          {currentSong && (
            <button onClick={() => {
              const p = `推荐5首和《${currentSong.name}》(${currentSong.artist})风格相似的歌曲`;
              setQuery(p); setMode('ai'); setFsPanel('search');
              handleAiRecommend(false, p);
            }}
              className="mt-2 text-[10px] px-3 py-1 rounded-full transition-all hover:opacity-80 font-medium"
              style={{ background: 'rgba(201,169,110,0.1)', color: GOLD, border: '1px solid rgba(201,169,110,0.2)' }}>
              找相似歌曲
            </button>
          )}
        </div>
        <div className="w-full max-w-sm mt-7">
          <div className="relative w-full h-1 rounded-full cursor-pointer" style={{ background: 'var(--card-bg)' }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const a = document.querySelector('audio'); if (a && duration > 0) a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration; }}><div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${fsProgressPercent}%`, background: GOLD }} /></div>
          <div className="flex justify-between text-[10px] mt-1.5" style={{ color: T.textTer }}><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="flex items-center gap-6 mt-5">
          <button
            onClick={() => {
              const next = store.playMode === 'order' ? 'shuffle' : store.playMode === 'shuffle' ? 'single' : 'order';
              store.setPlayMode(next);
              showToast(next === 'order' ? '顺序播放' : next === 'shuffle' ? '随机播放' : '单曲循环', 'info');
            }}
            className="p-2 rounded-full transition-all hover:scale-110"
            title={store.playMode === 'order' ? '顺序播放' : store.playMode === 'shuffle' ? '随机播放' : '单曲循环'}
            style={{ background: T.card, color: store.playMode !== 'order' ? GOLD : T.textSec }}>
            {store.playMode === 'shuffle' ? <Shuffle className="w-4 h-4" /> : store.playMode === 'single' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
          <button onClick={() => store.playPrev()} className="p-3 rounded-full transition-all hover:scale-110" style={{ background: T.card }}><SkipBack className="w-5 h-5" style={{ color: T.textSec }} /></button>
          <button onClick={() => store.setIsPlaying(!isPlaying)} className="p-5 rounded-full transition-all hover:scale-105" style={{ background: currentSong ? GOLD : T.card, boxShadow: currentSong ? '0 6px 24px rgba(201,169,110,0.3)' : 'none' }}>{isPlaying ? <Pause className="w-7 h-7 text-white" /> : <Play className="w-7 h-7 text-white ml-0.5" />}</button>
          <button onClick={() => store.playNext()} className="p-3 rounded-full transition-all hover:scale-110" style={{ background: T.card }}><SkipForward className="w-5 h-5" style={{ color: T.textSec }} /></button>
          <div className="w-8" />
        </div>
        <div className="flex items-center gap-4 mt-4 w-full max-w-xs">
          <button onClick={() => store.setVolume(store.volume > 0 ? 0 : 0.7)} style={{ color: T.textTer }}>{store.volume > 0 ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}</button>
          <input type="range" min={0} max={1} step={0.01} value={store.volume} onChange={(e) => store.setVolume(Number(e.target.value))} className="flex-1" />
          {currentSong && (<button onClick={() => { if (store.isFavorite(currentSong.id)) { store.removeFromFavorites(currentSong.id); feedbackToAi?.('unfavorite', currentSong); } else { store.addToFavorites(currentSong); feedbackToAi?.('favorite', currentSong); } }}><Heart className="w-4 h-4" style={{ color: store.isFavorite(currentSong.id) ? GOLD : T.textTer }} fill={store.isFavorite(currentSong.id) ? GOLD : 'none'} /></button>)}
          {currentSong && (<button onClick={() => { feedbackToAi?.('dislike', currentSong); store.playNext(); showToast('已告诉AI你不喜欢这首', 'info'); }} title="不喜欢"><ThumbsDown className="w-3.5 h-3.5" style={{ color: T.textTer }} /></button>)}
          {/* AI 解说开关（从一级菜单下放到当前播放区） */}
          <button onClick={() => setTtsEnabled(!ttsEnabled)} title={ttsEnabled ? 'AI 解说已开启，点击关闭' : '开启 AI 解说'}>
            <Mic2 className="w-3.5 h-3.5" style={{ color: ttsEnabled ? GOLD : T.textTer }} />
          </button>
        </div>
        {/* AI 电台模式徽标（仅电台模式下显示） */}
        {store.radioMode === 'station' && (
          <div className="flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full" style={{
            background: isDark ? 'rgba(201,169,110,0.12)' : 'rgba(201,169,110,0.18)',
            border: `1px solid ${isDark ? 'rgba(201,169,110,0.3)' : 'rgba(201,169,110,0.4)'}`,
          }}>
            <Radio className="w-3 h-3" style={{ color: GOLD }} />
            <span className="text-[10px] font-semibold" style={{ color: GOLD }}>AI 电台</span>
            <span className="text-[10px]" style={{ color: T.textSec }}>·</span>
            <span className="text-[10px]" style={{ color: T.textSec }}>{store.radioStyle && store.radioStyle.length > 14 ? store.radioStyle.slice(0, 14) + '…' : (store.radioStyle || '自定义')}</span>
            <button onClick={onExitRadio} className="ml-1 p-0.5 rounded-full hover:opacity-70" title="退出电台">
              <LogOut className="w-3 h-3" style={{ color: T.textTer }} />
            </button>
          </div>
        )}
        {store.djScript && currentSong && (
          <DjCard script={store.djScript} isDark={isDark} chatInput={chatInput} isChatLoading={store.isChatLoading}
            djStyle={djStyle} onStyleChange={setDjStyle}
            onClose={() => store.setDjScript(null)} onChatInputChange={setChatInput} onQuickChat={handleDjQuickChat} variant="landscape" />
        )}
      </div>

      {/* 歌词区 */}
      <div className="flex-1 flex flex-col justify-center items-center z-10 relative min-w-0" style={{ borderLeft: '1px solid var(--panel-border)' }}>
        {fsLyrics.length > 0 && currentSong ? (
          <div className="relative w-full h-[75vh] overflow-hidden max-w-md mx-auto">
            <div ref={lyricRef} className="absolute inset-0 overflow-y-auto scrollbar-hide py-36 px-6">
              {fsLyrics.map((line, i) => {
                const translation = showTranslation === false ? null : findTranslation(fsTranslationMap, line.time);
                return (
                  <button key={i} className="w-full py-2 transition-all duration-200 cursor-pointer text-center rounded-lg hover:opacity-80"
                    style={{ fontSize: i === fsActiveLyricIndex ? '18px' : '14px', fontWeight: i === fsActiveLyricIndex ? 700 : 400, color: i === fsActiveLyricIndex ? T.text : T.textTer }}
                    aria-label={`跳转到 ${formatTime(line.time)} ${line.text}`}
                    onClick={() => { const a = document.querySelector('audio'); if (a) { a.currentTime = line.time; store.setIsPlaying(true); } }}>
                    <span className="block">{line.text || '···'}</span>
                    {translation && <span className="block text-[11px] mt-1 font-normal opacity-65">{translation}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (<div className="flex flex-col items-center" style={{ color: 'var(--hover-border)' }}><Music className="w-12 h-12 mb-2" /><p className="text-sm">{currentSong ? '暂无歌词' : '等待播放'}</p></div>)}
      </div>
      </div>
    </div>
  );
}
