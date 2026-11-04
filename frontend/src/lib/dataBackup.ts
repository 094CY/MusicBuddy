import type { Song, ChatMessage } from '../types';

/** 用户数据备份格式（只含个人数据，绝不含任何 API Key 或密钥） */
export interface BackupData {
  version: 1;
  exportedAt: string;
  favorites: Song[];
  playHistory: Song[];
  chatMessages: ChatMessage[];
  searchHistory: string[];
  radioRecommendedHistory: string[];
  playMode: 'order' | 'shuffle' | 'single';
  volume: number;
  theme: 'dark' | 'light';
}

interface BackupSource {
  favorites: Song[];
  playHistory: Song[];
  chatMessages: ChatMessage[];
  searchHistory: string[];
  radioRecommendedHistory: string[];
  playMode: 'order' | 'shuffle' | 'single';
  volume: number;
}

/** 生成备份文件并触发下载 */
export function exportBackup(source: BackupSource): void {
  const data: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...source,
    theme: (localStorage.getItem('musicbuddy-theme') as 'dark' | 'light') || 'dark',
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `musicbuddy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 校验并读取备份文件，拒绝结构不符或体积异常的文件 */
export function parseBackup(text: string): BackupData {
  if (text.length > 20 * 1024 * 1024) throw new Error('文件过大（超过 20MB）');
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的备份文件');
  const d = raw as Partial<BackupData>;
  if (d.version !== 1) throw new Error('备份版本不兼容');
  const isSongArray = (v: unknown): v is Song[] =>
    Array.isArray(v) && v.every((s) => s && typeof s === 'object' && typeof (s as Song).name === 'string');
  if (!isSongArray(d.favorites) || !isSongArray(d.playHistory)) {
    throw new Error('备份文件缺少收藏或历史数据');
  }
  return {
    version: 1,
    exportedAt: d.exportedAt || '',
    favorites: d.favorites,
    playHistory: d.playHistory,
    chatMessages: Array.isArray(d.chatMessages) ? d.chatMessages : [],
    searchHistory: Array.isArray(d.searchHistory) ? d.searchHistory : [],
    radioRecommendedHistory: Array.isArray(d.radioRecommendedHistory) ? d.radioRecommendedHistory : [],
    playMode: d.playMode || 'order',
    volume: typeof d.volume === 'number' ? d.volume : 0.7,
    theme: d.theme === 'light' ? 'light' : 'dark',
  };
}
