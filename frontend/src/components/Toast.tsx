import { useEffect, useRef } from 'react';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  /** 自动消失时间（毫秒），默认 1800 */
  duration?: number;
}

/**
 * 全局 Toast：底部胶囊式、无边框、文字优先、自动消失
 * 关键：onClose 用 ref 持有，避免父组件每次 render 都新建函数导致 effect 反复重置 timer
 */
export default function Toast({ message, type = 'info', onClose, duration = 1800 }: ToastProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 仅在 message/duration 变化时重置定时器，与 onClose 引用解耦
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  const textColor = type === 'error' ? '#ff8a8a' : '#fff';

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[100] pointer-events-none animate-fade-in"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
    >
      <div
        className="px-4 py-2 rounded-full text-[12.5px] font-medium leading-tight whitespace-nowrap"
        style={{
          background: 'rgba(20,20,24,0.85)',
          color: textColor,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          maxWidth: '85vw',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {message}
      </div>
    </div>
  );
}
