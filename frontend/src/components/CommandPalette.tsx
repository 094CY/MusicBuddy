import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Heart, History, ListMusic, Download, Upload, X, CornerDownLeft, Trash2 } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { apiFetch, notify } from '../config';
import { exportBackup, parseBackup } from '../lib/dataBackup';
import { GOLD } from './player/utils';
import type { Song } from '../types';

type PanelItem =
  | { kind: 'song'; id: string; title: string; subtitle: string; badge: string; song: Song }
  | { kind: 'command'; id: string; title: string; subtitle: string; badge: string; run: () => void };

interface Props { onOpenSettings?: () => void }

/** 全局快捷键 + Ctrl/Cmd+K 命令面板：本地库优先检索，远端搜索作为补充 */
export default function CommandPalette({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchToken = useRef(0);

  const favorites = usePlayerStore((s) => s.favorites);
  const playHistory = usePlayerStore((s) => s.playHistory);
  const playlist = usePlayerStore((s) => s.playlist);

  // 全局快捷键（输入框聚焦时不劫持）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); return; }
      if (mod && e.key === ',') { e.preventDefault(); onOpenSettings?.(); return; }
      if (e.key === 'Escape') { setOpen(false); return; }
      if (inInput || open) return;

      const store = usePlayerStore.getState();
      if (e.code === 'Space') { e.preventDefault(); store.setIsPlaying(!store.isPlaying); return; }
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicbuddy:seek', { detail: { delta: 5 } }));
        return;
      }
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('musicbuddy:seek', { detail: { delta: -5 } }));
        return;
      }
      if (!mod && e.key.toLowerCase() === 'l' && store.currentSong) {
        e.preventDefault();
        const wasFavorite = store.isFavorite(store.currentSong.id);
        if (wasFavorite) store.removeFromFavorites(store.currentSong.id);
        else store.addToFavorites(store.currentSong);
        notify(wasFavorite ? '已取消收藏' : '已加入收藏', 'success');
        return;
      }
      if (!mod && e.key === '/') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenSettings]);

  useEffect(() => {
    if (!open) { setQuery(''); setRemote([]); setActiveIndex(0); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // 远端搜索（防抖 + 竞态保护）
  useEffect(() => {
    const kw = query.trim();
    if (!open || !kw) { setRemote([]); return; }
    const token = ++searchToken.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/music/multi-search?keywords=${encodeURIComponent(kw)}&platforms=netease,qq,youtube&limit=8`, { timeoutMs: 12000 });
        const data = await res.json();
        if (token !== searchToken.current) return;
        const list: Song[] = [];
        for (const p of ['netease', 'qq', 'youtube']) list.push(...(data.results?.[p] || []));
        setRemote(list.slice(0, 12));
      } catch { if (token === searchToken.current) setRemote([]); }
      finally { if (token === searchToken.current) setSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, open]);

  const handleExport = () => {
    const s = usePlayerStore.getState();
    exportBackup({
      favorites: s.favorites, playHistory: s.playHistory, chatMessages: s.chatMessages,
      searchHistory: s.searchHistory, radioRecommendedHistory: s.radioRecommendedHistory,
      playMode: s.playMode, volume: s.volume,
    });
    notify('已导出个人数据备份', 'success');
  };

  const handleImportFile = async (file: File) => {
    try {
      const data = parseBackup(await file.text());
      usePlayerStore.setState({
        favorites: data.favorites, playHistory: data.playHistory, chatMessages: data.chatMessages,
        searchHistory: data.searchHistory, radioRecommendedHistory: data.radioRecommendedHistory,
        playMode: data.playMode, volume: data.volume, lastCleared: null,
      });
      localStorage.setItem('musicbuddy-theme', data.theme);
      document.documentElement.setAttribute('data-theme', data.theme);
      notify(`已导入 ${data.favorites.length} 首收藏、${data.playHistory.length} 条历史`, 'success');
    } catch (e: any) {
      notify(`导入失败：${e.message || '文件格式不正确'}`, 'error');
    }
  };

  const items = useMemo<PanelItem[]>(() => {
    const kw = query.trim().toLowerCase();
    const match = (s: Song) => !kw || `${s.name} ${s.artist}`.toLowerCase().includes(kw);
    const result: PanelItem[] = [];
    const seen = new Set<string>();

    const addSongs = (songs: Song[], badge: string, limit: number) => {
      for (const song of songs.filter(match).slice(0, limit)) {
        const key = `${song.id}_${song.platform || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ kind: 'song', id: `${badge}-${key}`, title: song.name, subtitle: song.artist, badge, song });
      }
    };
    addSongs(favorites, '收藏', 6);
    addSongs(playlist, '队列', 4);
    addSongs(playHistory, '历史', 4);
    if (kw) addSongs(remote, '全网', 8);

    // 命令只在无关键词或关键词匹配时展示
    const cmdMatch = (t: string) => !kw || t.toLowerCase().includes(kw);
    if (cmdMatch('导出')) result.push({ kind: 'command', id: 'export', title: '导出个人数据', subtitle: '收藏 / 历史 / 偏好备份为 JSON', badge: '命令', run: handleExport });
    if (cmdMatch('导入')) result.push({ kind: 'command', id: 'import', title: '导入个人数据', subtitle: '从 JSON 备份恢复', badge: '命令', run: () => fileRef.current?.click() });
    if (cmdMatch('设置')) result.push({ kind: 'command', id: 'settings', title: '打开设置', subtitle: '服务配置、音源、主题、数据管理 · ⌘,', badge: '命令', run: () => onOpenSettings?.() });
    return result;
  }, [query, favorites, playlist, playHistory, remote, onOpenSettings]);

  const runItem = (item: PanelItem) => {
    if (item.kind === 'command') { item.run(); setOpen(false); return; }
    const store = usePlayerStore.getState();
    store.playFromList([item.song], 0, 'search');
    store.setPlaySource('search');
    setOpen(false);
  };

  const onPaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[activeIndex]) { e.preventDefault(); runItem(items[activeIndex]); }
  };

  if (!open) return (
    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-hidden="true"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
  );

  return (
    <>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
      <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh]"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="w-full max-w-lg rounded-2xl overflow-hidden animate-fade-in"
          style={{ background: 'var(--slide-panel-bg)', border: '1px solid var(--panel-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
          role="dialog" aria-modal="true" aria-label="命令面板">
          <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: '1px solid var(--card-border)' }}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: GOLD }} />
            <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
              onKeyDown={onPaletteKeyDown} placeholder="搜索收藏 / 队列 / 历史，或输入命令…"
              className="flex-1 bg-transparent outline-none text-[13px]" style={{ color: 'var(--text-primary)' }} aria-label="命令面板搜索" />
            {searching && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>搜索中…</span>}
            <button onClick={() => setOpen(false)} aria-label="关闭命令面板"><X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /></button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto py-2">
            {items.length === 0 && (
              <p className="text-center text-xs py-8" style={{ color: 'var(--text-tertiary)' }}>没有匹配结果</p>
            )}
            {items.map((item, i) => {
              const Icon = item.kind === 'command'
                ? (item.id === 'export' ? Download : item.id === 'import' ? Upload : Trash2)
                : item.badge === '收藏' ? Heart : item.badge === '历史' ? History : item.badge === '队列' ? ListMusic : Search;
              return (
                <button key={item.id} onClick={() => runItem(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all"
                  style={{ background: i === activeIndex ? 'var(--hover-bg)' : 'transparent' }}>
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: item.kind === 'command' ? GOLD : 'var(--text-tertiary)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{item.subtitle}</p>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: 'var(--card-bg)', color: 'var(--text-tertiary)', border: '1px solid var(--card-border)' }}>{item.badge}</span>
                  {i === activeIndex && <CornerDownLeft className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                </button>
              );
            })}
          </div>

          <div className="px-4 py-2.5 flex items-center gap-3 text-[10px]"
            style={{ borderTop: '1px solid var(--card-border)', color: 'var(--text-tertiary)' }}>
            <span>↑↓ 选择</span><span>↵ 播放</span><span>Esc 关闭</span>
            <span className="ml-auto">空格 播放 · ←→ 快进 · L 收藏 · ⌘Z 撤销</span>
          </div>
        </div>
      </div>
    </>
  );
}
