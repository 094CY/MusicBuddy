import { useEffect, useState, useRef } from 'react';
import { AlertCircle, RefreshCw, SkipForward, Undo2, Sparkles, X } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { GOLD } from './player/utils';

interface Notice { message: string; type: 'error' | 'success' | 'info' }

const CLEAR_LABEL: Record<string, string> = {
  favorites: '收藏', history: '播放历史', chat: '对话', playlist: '播放列表',
};

/**
 * 全局浮层：统一承接通知、播放错误、缓冲、清空撤销、版本更新提示。
 * 通过 store 与自定义事件通信，不侵入 PlayerPage 的布局逻辑。
 */
export default function GlobalOverlays() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const playbackError = usePlayerStore((s) => s.playbackError);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const lastCleared = usePlayerStore((s) => s.lastCleared);
  const retryPlayback = usePlayerStore((s) => s.retryPlayback);
  const setPlaybackError = usePlayerStore((s) => s.setPlaybackError);
  const undoLastClear = usePlayerStore((s) => s.undoLastClear);
  const playNext = usePlayerStore((s) => s.playNext);

  const showNotice = (n: Notice) => {
    setNotice(n);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), n.type === 'error' ? 4000 : 2500);
  };

  useEffect(() => {
    const onNotice = (e: Event) => {
      const detail = (e as CustomEvent<Notice>).detail;
      if (detail?.message) showNotice(detail);
    };
    const onUpdate = () => setHasUpdate(true);
    window.addEventListener('musicbuddy:notice', onNotice);
    window.addEventListener('musicbuddy:app-update', onUpdate);
    return () => {
      window.removeEventListener('musicbuddy:notice', onNotice);
      window.removeEventListener('musicbuddy:app-update', onUpdate);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  // 撤销浮层 6 秒后自动收起（过期后 Cmd+Z 不再生效，避免误撤销很久之前的操作）
  useEffect(() => {
    if (!lastCleared) return;
    const t = window.setTimeout(() => {
      usePlayerStore.setState({ lastCleared: null });
    }, 6000);
    return () => window.clearTimeout(t);
  }, [lastCleared]);

  // Cmd/Ctrl+Z：撤销最近一次清空
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (!usePlayerStore.getState().lastCleared) return;
      e.preventDefault();
      undoLastClear();
      showNotice({ message: '已撤销清空操作', type: 'success' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoLastClear]);

  const applyUpdate = () => {
    navigator.serviceWorker?.getRegistration?.().then((reg) => {
      reg?.waiting?.postMessage('SKIP_WAITING');
    });
    window.location.reload();
  };

  return (
    <>
      {/* 播放错误：提供可见的重试 / 跳过，而不是静默跳歌 */}
      {playbackError && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[120] w-[min(92vw,420px)]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl"
            style={{ background: 'rgba(28,22,22,0.94)', border: '1px solid rgba(239,68,68,0.35)', backdropFilter: 'blur(16px)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#ff8a8a' }} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium truncate" style={{ color: '#fff' }}>{playbackError.songName}</p>
              <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{playbackError.message}</p>
            </div>
            <button onClick={() => { setPlaybackError(null); retryPlayback(); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex-shrink-0"
              style={{ background: GOLD, color: '#0a0a0a' }} aria-label="换源重试">
              <RefreshCw className="w-3 h-3" /> 重试
            </button>
            <button onClick={() => { setPlaybackError(null); playNext(); }}
              className="p-1.5 rounded-lg flex-shrink-0" style={{ color: 'rgba(255,255,255,0.7)' }} aria-label="跳过这首歌">
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 缓冲态 */}
      {isBuffering && !playbackError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[110] px-3 py-1.5 rounded-full text-[11px]"
          style={{ background: 'rgba(20,20,24,0.85)', color: '#fff', backdropFilter: 'blur(12px)' }}>
          正在缓冲…
        </div>
      )}

      {/* 清空后可撤销 */}
      {lastCleared && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[130] w-[min(92vw,420px)]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
            style={{ background: 'rgba(20,20,24,0.94)', border: '1px solid var(--card-border)', backdropFilter: 'blur(16px)' }}>
            <span className="flex-1 text-[12px] truncate" style={{ color: '#fff' }}>
              已清空{CLEAR_LABEL[lastCleared.kind] || '数据'}
            </span>
            <button onClick={() => { undoLastClear(); showNotice({ message: '已撤销清空操作', type: 'success' }); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
              style={{ background: GOLD, color: '#0a0a0a' }}>
              <Undo2 className="w-3 h-3" /> 撤销
            </button>
            <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.45)' }}>⌘Z</span>
          </div>
        </div>
      )}

      {/* 新版本提示 */}
      {hasUpdate && (
        <div className="fixed top-4 right-4 z-[140] w-[min(92vw,320px)]">
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl"
            style={{ background: 'rgba(20,20,24,0.94)', border: `1px solid ${GOLD}55`, backdropFilter: 'blur(16px)' }}>
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: GOLD }} />
            <span className="flex-1 text-[12px]" style={{ color: '#fff' }}>有新版本可用</span>
            <button onClick={applyUpdate} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
              style={{ background: GOLD, color: '#0a0a0a' }}>立即更新</button>
            <button onClick={() => setHasUpdate(false)} aria-label="关闭提示" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 全局通知 */}
      {notice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] px-4 py-2 rounded-full text-[12px] font-medium animate-fade-in"
          style={{
            background: 'rgba(20,20,24,0.9)',
            color: notice.type === 'error' ? '#ff8a8a' : notice.type === 'success' ? GOLD : '#fff',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${notice.type === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--card-border)'}`,
          }} role="status">
          {notice.message}
        </div>
      )}
    </>
  );
}
