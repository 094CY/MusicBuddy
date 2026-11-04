import { Plus, Trash2 } from 'lucide-react';
import type { Song } from '../../types';
import { formatDuration, GOLD } from './utils';
import { usePlayerStore } from '../../store/playerStore';

interface SongRowProps {
  song: Song;
  index: number;
  isDark: boolean;
  showRemove?: boolean;
  onRemove?: () => void;
  onPlay: (song: Song) => void;
  onAdd: (song: Song) => void;
  onClosePanel?: () => void;
  /** 可选副标题：用于展示 AI 推荐理由 */
  reason?: string;
}

export default function SongRow({ song, isDark, showRemove, onRemove, onPlay, onAdd, onClosePanel, reason }: SongRowProps) {
  // 直接订阅 currentSong/isPlaying，确保所有调用 SongRow 的面板都自动获得高亮态
  const currentSongId = usePlayerStore((s) => s.currentSong?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrent = currentSongId !== undefined && currentSongId === song.id;
  const subtitle = reason || song.reason;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`播放 ${song.name} - ${song.artist}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPlay(song);
          onClosePanel?.();
        }
      }}
      className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1 outline-none focus-visible:ring-2"
      style={{
        border: '1px solid transparent',
        background: isCurrent ? 'rgba(201,169,110,0.12)' : 'transparent',
        borderColor: isCurrent ? 'rgba(201,169,110,0.35)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (isCurrent) return;
        (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--hover-border)';
      }}
      onMouseLeave={(e) => {
        if (isCurrent) return;
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
      }}
      onClick={() => { onPlay(song); onClosePanel?.(); }}
    >
      {/* 当前播放指示器（仅当前播放时显示，与播放列表面板序号位的频谱图标视觉一致） */}
      {isCurrent && (
        <span className="inline-flex gap-[2px] items-end h-3 w-3 flex-shrink-0">
          <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '60%', animationPlayState: isPlaying ? 'running' : 'paused' }} />
          <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '100%', animationDelay: '0.1s', animationPlayState: isPlaying ? 'running' : 'paused' }} />
          <span className="w-[2px] rounded-sm equalizer-bar" style={{ background: GOLD, height: '75%', animationDelay: '0.2s', animationPlayState: isPlaying ? 'running' : 'paused' }} />
        </span>
      )}

      {/* 封面（当前播放时无遮罩，保持封面原貌） */}
      <div className="relative w-11 h-11 rounded-lg flex-shrink-0 overflow-hidden">
        {song.cover ? (
          <img src={song.cover} alt="" className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--card-bg)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-icon)" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium truncate" style={{ color: isCurrent ? GOLD : 'var(--text-primary)' }}>{song.name}</p>
          {song.platform && (
            <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{
              background: song.platform === 'youtube' ? 'rgba(255,0,0,0.12)' : song.platform === 'qq' ? 'rgba(201,169,110,0.18)' : 'rgba(100,149,237,0.15)',
              color: song.platform === 'youtube'
                ? (isDark ? 'rgba(255,80,80,0.9)' : 'rgba(180,30,30,0.9)')
                : song.platform === 'qq'
                ? (isDark ? 'rgba(201,169,110,0.9)' : 'rgba(140,110,50,0.95)')
                : (isDark ? 'rgba(120,160,255,0.9)' : 'rgba(50,90,200,0.9)'),
              border: `1px solid ${song.platform === 'youtube' ? 'rgba(255,0,0,0.2)' : song.platform === 'qq' ? 'rgba(201,169,110,0.3)' : 'rgba(100,149,237,0.25)'}`,
            }}>
              {song.platformName || song.platform}
            </span>
          )}
          {song.fee === 1 ? (
            <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: isDark ? 'rgba(255,100,100,0.15)' : 'rgba(220,50,50,0.1)', color: isDark ? 'rgba(255,120,120,0.9)' : 'rgba(180,30,30,0.95)', border: `1px solid ${isDark ? 'rgba(255,100,100,0.2)' : 'rgba(200,50,50,0.25)'}` }}>试听</span>
          ) : (
            <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: isDark ? 'rgba(100,255,100,0.1)' : 'rgba(30,160,60,0.1)', color: isDark ? 'rgba(100,255,100,0.85)' : 'rgba(20,110,40,0.95)', border: `1px solid ${isDark ? 'rgba(100,255,100,0.2)' : 'rgba(30,160,60,0.25)'}` }}>免费</span>
          )}
        </div>
        <p className="text-[11px] truncate" style={{ color: isCurrent ? 'rgba(201,169,110,0.85)' : 'var(--text-secondary)' }}>{song.artist}</p>
        {subtitle && (
          <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{formatDuration(song.duration)}</span>
        {showRemove && onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
            style={{ background: 'var(--card-bg)' }}
          >
            <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(song); }}
          className="p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
          style={{ background: 'var(--card-bg)' }}
        >
          <Plus className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>
    </div>
  );
}
