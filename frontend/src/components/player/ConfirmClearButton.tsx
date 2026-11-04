import { useEffect, useState } from 'react';

interface Props {
  onClick: () => void;
  label?: string;
  className?: string;
}

/** 破坏性操作的二次确认按钮：首次点击变为「确认清空？」，3 秒后自动复位。
 *  清空后另有全局撤销浮层（⌘Z）作为第二重保障。 */
export default function ConfirmClearButton({ onClick, label = '清空', className }: Props) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <button
      onClick={() => {
        if (confirming) { onClick(); setConfirming(false); }
        else setConfirming(true);
      }}
      aria-label={confirming ? `确认${label}` : label}
      className={className || 'text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all hover:opacity-80'}
      style={{
        color: confirming ? '#ff8a8a' : 'var(--text-secondary)',
        background: 'var(--card-bg)',
        border: `1px solid ${confirming ? 'rgba(239,68,68,0.5)' : 'var(--card-border)'}`,
      }}>
      {confirming ? `确认${label}？` : label}
    </button>
  );
}
