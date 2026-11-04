import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PlayerState, Song, ChatMessage } from '../types';

const STORAGE_KEY = 'musicbuddy-state';

const storage = {
  getItem: (name: string): string | null => localStorage.getItem(name),
  setItem: (name: string, value: string) => { localStorage.setItem(name, value); },
  removeItem: (name: string) => { localStorage.removeItem(name); },
};

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.7,
      playlist: [],
      currentIndex: -1,
      lyric: '',
      tlyric: '',
      searchResults: [],
      aiRecommendSongs: [],
      recommendation: null,
      isSearching: false,
      isRecommending: false,
      ttsUrl: null,
      isTtsLoading: false,
      djScript: null,
      favorites: [],
      playHistory: [],
      chatMessages: [],
      isChatLoading: false,
      searchHistory: [],
      playSource: null,
      playMode: 'order',
      radioMode: null,
      radioStyle: null,
      radioStylePreset: null,
      radioRecommendedHistory: [],
      isBuffering: false,
      playbackError: null,
      playbackRetryToken: 0,
      lastCleared: null,

      setBuffering: (v) => set({ isBuffering: v }),
      setPlaybackError: (e) => set({ playbackError: e }),
      retryPlayback: () => set((state) => ({ playbackRetryToken: state.playbackRetryToken + 1, playbackError: null })),
      undoLastClear: () => set((state) => {
        const snap = state.lastCleared;
        if (!snap) return state;
        const patch: Partial<PlayerState> = { lastCleared: null };
        if (snap.kind === 'favorites') patch.favorites = snap.data as Song[];
        if (snap.kind === 'history') patch.playHistory = snap.data as Song[];
        if (snap.kind === 'chat') patch.chatMessages = snap.data as ChatMessage[];
        if (snap.kind === 'playlist') patch.playlist = snap.data as Song[];
        return patch;
      }),

      setCurrentSong: (song) => {
        // 不在这里写历史；歌曲实际播完才在 AudioPlayer.onEnded 写入
        // 切歌立即清空歌词，避免旧歌词残留到新歌
        set({ currentSong: song, currentTime: 0, lyric: '', tlyric: '' });
      },
      setIsPlaying: (playing) => set({ isPlaying: playing }),
      setCurrentTime: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),
      setVolume: (volume) => set({ volume }),

      setPlaylist: (songs) => set({ playlist: songs, currentIndex: songs.length > 0 ? 0 : -1 }),
      addToPlaylist: (song) => set((state) => {
        const exists = state.playlist.find((s) => s.id === song.id);
        if (exists) return state;
        // 追加到末尾，currentIndex 不变（指向当前播放的歌）
        return { playlist: [...state.playlist, song] };
      }),
      removeFromPlaylist: (index) => set((state) => {
        if (index < 0 || index >= state.playlist.length) return state;
        const removingCurrent = index === state.currentIndex;
        const newPlaylist = state.playlist.filter((_, i) => i !== index);

        if (newPlaylist.length === 0) {
          // 清空：保留 currentSong（让用户能继续看到歌词），但停止播放
          return {
            playlist: [],
            currentIndex: -1,
            isPlaying: false,
          };
        }

        let newIndex = state.currentIndex;
        if (index < state.currentIndex) {
          // 删除的是当前歌之前的：索引前移
          newIndex = state.currentIndex - 1;
        } else if (removingCurrent) {
          // 删除的就是当前歌：保持 newIndex，但要 clamp 到合法范围；同时跳到下一首
          if (newIndex >= newPlaylist.length) newIndex = 0;
        }

        return {
          playlist: newPlaylist,
          currentIndex: newIndex,
          currentSong: removingCurrent ? newPlaylist[newIndex] : state.currentSong,
          currentTime: removingCurrent ? 0 : state.currentTime,
        };
      }),

      playNext: () => set((state) => {
        if (state.playlist.length === 0) return { isPlaying: false };
        // 单曲循环
        if (state.playMode === 'single') {
          return {
            currentSong: state.playlist[state.currentIndex] || state.currentSong,
            currentTime: 0,
            isPlaying: true,
          };
        }
        // 随机模式：在 playlist 内部随机
        if (state.playMode === 'shuffle' && state.playlist.length > 1) {
          let nextIndex = Math.floor(Math.random() * state.playlist.length);
          if (nextIndex === state.currentIndex) {
            nextIndex = (nextIndex + 1) % state.playlist.length;
          }
          return {
            currentIndex: nextIndex,
            currentSong: state.playlist[nextIndex],
            currentTime: 0,
            isPlaying: true,
          };
        }

        // 顺序播放：
        // 0) AI 电台模式末尾：不循环，保持当前位置等 PlayerPage 异步拉新追加
        const isAtEnd = state.currentIndex >= state.playlist.length - 1;
        if (state.radioMode === 'station' && isAtEnd) {
          return { isPlaying: false }; // 暂停等待续流；PlayerPage 监听到会拉新
        }
        // 1) 仅 search 来源在末尾时从搜索结果/AI 推荐列表追加下一首
        // （收藏/历史/列表已经在 handlePlaySong 时整列表入队，这里直接走 playlist 循环即可）
        if (isAtEnd && state.playSource === 'search') {
          const sourceList = state.searchResults.length > 0 ? state.searchResults : state.aiRecommendSongs;
          if (sourceList.length > 0 && state.currentSong) {
            const idx = sourceList.findIndex((s) => s.id === state.currentSong?.id);
            for (let i = Math.max(idx, 0) + 1; i < sourceList.length; i++) {
              const cand = sourceList[i];
              if (!state.playlist.find((p) => p.id === cand.id)) {
                const newPlaylist = [...state.playlist, cand];
                return {
                  playlist: newPlaylist,
                  currentIndex: newPlaylist.length - 1,
                  currentSong: cand,
                  currentTime: 0,
                  isPlaying: true,
                };
              }
            }
          }
        }

        // 2) 回到 playlist 循环（到末尾回到 0）
        const nextIndex = isAtEnd ? 0 : state.currentIndex + 1;
        return {
          currentIndex: nextIndex,
          currentSong: state.playlist[nextIndex],
          currentTime: 0,
          isPlaying: true,
        };
      }),

      playPrev: () => set((state) => {
        if (state.playlist.length === 0) return state;
        if (state.playMode === 'shuffle' && state.playlist.length > 1) {
          let prevIndex = Math.floor(Math.random() * state.playlist.length);
          if (prevIndex === state.currentIndex) {
            prevIndex = (prevIndex - 1 + state.playlist.length) % state.playlist.length;
          }
          return {
            currentIndex: prevIndex,
            currentSong: state.playlist[prevIndex],
            currentTime: 0,
            isPlaying: true,
          };
        }
        const prevIndex = state.currentIndex <= 0
          ? state.playlist.length - 1
          : state.currentIndex - 1;
        return {
          currentIndex: prevIndex,
          currentSong: state.playlist[prevIndex],
          currentTime: 0,
          isPlaying: true,
        };
      }),

      // 关键：从某个列表（收藏/历史/搜索/播放列表）点击某首歌开始播放
      // 把整个列表设为 playlist，并定位到点击的那首
      playFromList: (songs, index, source) => set(() => {
        if (!songs.length || index < 0 || index >= songs.length) return {};
        return {
          playlist: [...songs],
          currentIndex: index,
          currentSong: songs[index],
          currentTime: 0,
          isPlaying: true,
          playSource: source,
        };
      }),

      setLyric: (lyric, tlyric) => set({ lyric, tlyric: tlyric || '' }),
      setSearchResults: (songs) => set({ searchResults: songs }),
      setAiRecommendSongs: (songs) => set({ aiRecommendSongs: songs }),
      setRecommendation: (rec) => set({ recommendation: rec }),
      setIsSearching: (v) => set({ isSearching: v }),
      setIsRecommending: (v) => set({ isRecommending: v }),
      setTtsUrl: (url) => set({ ttsUrl: url }),
      setIsTtsLoading: (v) => set({ isTtsLoading: v }),
      setDjScript: (script) => set({ djScript: script }),
      // 清空类操作保存快照，支持 Toast「撤销」与 Cmd+Z
      clearPlaylist: () => set((state) => ({
        playlist: [], currentIndex: -1, currentSong: null,
        lastCleared: { kind: 'playlist', data: state.playlist },
      })),

      addToFavorites: (song) => set((state) => {
        if (state.favorites.find((s) => s.id === song.id)) return state;
        return { favorites: [song, ...state.favorites] };
      }),
      removeFromFavorites: (id) => set((state) => ({
        favorites: state.favorites.filter((s) => s.id !== id),
      })),
      isFavorite: (id) => get().favorites.some((s) => s.id === id),
      addToHistory: (song) => set((state) => {
        const filtered = state.playHistory.filter((s) => s.id !== song.id);
        const entry: Song = { ...song, playedAt: song.playedAt || Date.now() };
        return { playHistory: [entry, ...filtered].slice(0, 100) };
      }),
      clearHistory: () => set((state) => ({
        playHistory: [], lastCleared: { kind: 'history', data: state.playHistory },
      })),
      clearFavorites: () => set((state) => ({
        favorites: [], lastCleared: { kind: 'favorites', data: state.favorites },
      })),
      addChatMessage: (msg) => set((state) => ({
        // 限制聊天记录长度，避免 localStorage 无限膨胀拖慢首屏 hydration
        chatMessages: [...state.chatMessages, msg].slice(-100),
      })),
      deleteChatMessage: (index) => set((state) => ({
        chatMessages: state.chatMessages.filter((_, i) => i !== index),
      })),
      clearChat: () => set((state) => ({
        chatMessages: [], lastCleared: { kind: 'chat', data: state.chatMessages },
      })),
      setIsChatLoading: (v) => set({ isChatLoading: v }),
      addSearchHistory: (keyword) => set((state) => {
        const filtered = state.searchHistory.filter((k) => k !== keyword);
        return { searchHistory: [keyword, ...filtered].slice(0, 10) };
      }),
      clearSearchHistory: () => set({ searchHistory: [] }),
      setPlaySource: (source) => set({ playSource: source }),
      setPlayMode: (mode) => set({ playMode: mode }),
      enterRadioMode: (style, preset) => set({
        radioMode: 'station',
        radioStyle: style,
        radioStylePreset: preset,
        playSource: 'radio',
        playMode: 'order',
      }),
      exitRadioMode: () => set({ radioMode: null, radioStyle: null, radioStylePreset: null }),
      setRadioStyle: (style, preset) => set({ radioStyle: style, radioStylePreset: preset }),
      // 电台推荐历史管理（持久化，跨会话去重）
      addToRadioHistory: (items) => set((state) => {
        const existing = new Set(state.radioRecommendedHistory);
        const newItems = items.filter((i) => !existing.has(i));
        // 保留最近 200 条，超出时淘汰最早的（FIFO）
        const merged = [...state.radioRecommendedHistory, ...newItems];
        return { radioRecommendedHistory: merged.slice(-200) };
      }),
      clearRadioHistory: () => set({ radioRecommendedHistory: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => storage),
      version: 2,
      migrate: (persisted) => {
        const data = (persisted || {}) as Partial<PlayerState>;
        // v1 → v2：校验数组字段，清除脏数据；补齐新增字段默认值
        const safeArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
        return {
          ...data,
          favorites: safeArray(data.favorites),
          playHistory: safeArray(data.playHistory),
          playlist: safeArray(data.playlist),
          chatMessages: safeArray(data.chatMessages).slice(-100),
          searchHistory: safeArray(data.searchHistory).slice(0, 10),
          radioRecommendedHistory: safeArray(data.radioRecommendedHistory).slice(-200),
          volume: typeof data.volume === 'number' ? data.volume : 0.7,
          playMode: data.playMode || 'order',
          isBuffering: false,
          playbackError: null,
          playbackRetryToken: 0,
          lastCleared: null,
        } as PlayerState;
      },
      partialize: (state) => {
        // 持久化前剥离短期失效字段：YouTube/QQ 的 url 4-6 小时即失效，重启后必须重新获取
        const stripUrl = (s: any) => {
          if (!s) return s;
          if (s.platform && s.platform !== 'netease') {
            const { url, ...rest } = s;
            return rest;
          }
          return s;
        };
        return {
          volume: state.volume,
          favorites: state.favorites.map(stripUrl),
          playHistory: state.playHistory.map(stripUrl),
          playlist: state.playlist.map(stripUrl),
          currentIndex: state.currentIndex,
          chatMessages: state.chatMessages,
          searchHistory: state.searchHistory,
          playMode: state.playMode,
          radioMode: state.radioMode,
          radioStyle: state.radioStyle,
          radioStylePreset: state.radioStylePreset,
          radioRecommendedHistory: state.radioRecommendedHistory,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 修复半残状态：playlist + currentIndex 持久化但 currentSong 没有
        // 恢复后用 playlist[currentIndex] 反推 currentSong（不自动播放）
        if (state.playlist.length > 0 && state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
          state.currentSong = state.playlist[state.currentIndex];
          state.isPlaying = false; // 永远不自动播放
          state.currentTime = 0;
        } else {
          state.currentSong = null;
          state.currentIndex = -1;
        }
      },
    }
  )
);

// 统一兜底：任何切歌路径（自动续流、上一首、来源接续、随机、列表切换）
// 只要歌曲身份变化就立即清空歌词，避免旧歌词短暂或长期残留。
let lastLyricSongKey = '';
usePlayerStore.subscribe((state) => {
  const song = state.currentSong;
  const key = song
    ? `${song.platform || 'netease'}|${song.id}|${song.name}|${song.artist}`
    : '';
  if (key === lastLyricSongKey) return;
  lastLyricSongKey = key;
  if (state.lyric || state.tlyric) {
    usePlayerStore.setState({ lyric: '', tlyric: '' });
  }
});
