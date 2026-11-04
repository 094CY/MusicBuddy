/** 同一首歌在其他平台的可选音源，用于播放失败时自动换源 */
export interface SongAlternative {
  platform: 'netease' | 'qq' | 'youtube';
  id: number | string;
}

export interface Song {
  id: number | string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  url?: string;
  duration: number;
  fee?: number;
  platform?: 'netease' | 'qq' | 'youtube';
  platformName?: string;
  playable?: boolean;
  alternatives?: SongAlternative[];
  /** AI 推荐理由（可选，列表副标题展示） */
  reason?: string;
  /** 播放历史写入时间（可选，用于按日分组） */
  playedAt?: number;
}

export interface Recommendation {
  mood: string;
  intro: string;
  songs: { name: string; artist: string; reason: string }[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playlist: Song[];
  currentIndex: number;
  lyric: string;
  tlyric: string;
  searchResults: Song[];
  aiRecommendSongs: Song[];
  recommendation: Recommendation | null;
  isSearching: boolean;
  isRecommending: boolean;
  ttsUrl: string | null;
  isTtsLoading: boolean;
  djScript: string | null;
  favorites: Song[];
  playHistory: Song[];
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  searchHistory: string[];
  playSource: 'playlist' | 'favorites' | 'history' | 'search' | 'radio' | null;
  playMode: 'order' | 'shuffle' | 'single';
  // AI 电台模式
  radioMode: 'station' | null;
  radioStyle: string | null;          // 风格描述（用于 prompt）
  radioStylePreset: string | null;    // 风格预设 key（用于 UI 高亮）
  // 电台推荐历史（跨会话持久化，用于去重避免重复推荐）
  radioRecommendedHistory: string[];  // "歌名 - 艺人" 格式的列表
  // 播放状态与错误（P0 播放可用性）
  isBuffering: boolean;
  playbackError: { songName: string; message: string } | null;
  playbackRetryToken: number;
  /** 最近一次清空操作的快照，用于撤销 */
  lastCleared: { kind: 'favorites' | 'history' | 'chat' | 'playlist'; data: unknown } | null;

  setBuffering: (v: boolean) => void;
  setPlaybackError: (e: { songName: string; message: string } | null) => void;
  retryPlayback: () => void;
  undoLastClear: () => void;

  setCurrentSong: (song: Song | null) => void;
  setPlaySource: (source: 'playlist' | 'favorites' | 'history' | 'search' | 'radio' | null) => void;
  setPlayMode: (mode: 'order' | 'shuffle' | 'single') => void;
  playFromList: (songs: Song[], index: number, source: 'playlist' | 'favorites' | 'history' | 'search' | 'radio') => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setPlaylist: (songs: Song[]) => void;
  addToPlaylist: (song: Song) => void;
  removeFromPlaylist: (index: number) => void;
  playNext: () => void;
  playPrev: () => void;
  setLyric: (lyric: string, tlyric?: string) => void;
  setSearchResults: (songs: Song[]) => void;
  setAiRecommendSongs: (songs: Song[]) => void;
  setRecommendation: (rec: Recommendation | null) => void;
  setIsSearching: (v: boolean) => void;
  setIsRecommending: (v: boolean) => void;
  setTtsUrl: (url: string | null) => void;
  setIsTtsLoading: (v: boolean) => void;
  setDjScript: (script: string | null) => void;
  clearPlaylist: () => void;
  addToFavorites: (song: Song) => void;
  removeFromFavorites: (id: number | string) => void;
  isFavorite: (id: number | string) => boolean;
  clearFavorites: () => void;
  addToHistory: (song: Song) => void;
  clearHistory: () => void;
  addChatMessage: (msg: ChatMessage) => void;
  deleteChatMessage: (index: number) => void;
  clearChat: () => void;
  setIsChatLoading: (v: boolean) => void;
  addSearchHistory: (keyword: string) => void;
  clearSearchHistory: () => void;
  // AI 电台
  enterRadioMode: (style: string, preset: string | null) => void;
  exitRadioMode: () => void;
  setRadioStyle: (style: string, preset: string | null) => void;
  // 电台推荐历史管理
  addToRadioHistory: (items: string[]) => void;  // 追加"歌名 - 艺人"
  clearRadioHistory: () => void;                  // 清空历史（新鲜重来）
}
