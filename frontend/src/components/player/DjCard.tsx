import { Mic2, Send, X } from 'lucide-react';
import { GOLD } from './utils';

const DJ_STYLES = [
  { key: 'night', label: '深夜' },
  { key: 'energy', label: '活力' },
  { key: 'literary', label: '文艺' },
] as const;

interface DjCardProps {
  script: string;
  isDark: boolean;
  chatInput: string;
  isChatLoading: boolean;
  djStyle: 'night' | 'energy' | 'literary';
  onClose: () => void;
  onChatInputChange: (value: string) => void;
  onQuickChat: () => void;
  onStyleChange: (style: 'night' | 'energy' | 'literary') => void;
  variant?: 'portrait' | 'landscape';
}

export default function DjCard({ script, isDark, chatInput, isChatLoading, djStyle, onClose, onChatInputChange, onQuickChat, onStyleChange, variant = 'portrait' }: DjCardProps) {
  const isLandscape = variant === 'landscape';

  return (
    <div className={`${isLandscape ? 'w-full max-w-sm mt-4 rounded-xl' : 'w-full mt-6 rounded-2xl'} p-4 pb-3 animate-fade-in`}
      style={{
        background: isDark ? 'rgba(201,169,110,0.04)' : 'rgba(201,169,110,0.05)',
        border: '1px solid rgba(201,169,110,0.12)',
        backdropFilter: isLandscape ? undefined : 'blur(18px) saturate(1.2)',
      }}>
      {/* 标题行 */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <Mic2 className="w-3 h-3 flex-shrink-0" style={{ color: GOLD }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: GOLD }}>AI 解说</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {DJ_STYLES.map(({ key, label }) => (
            <button key={key} onClick={() => onStyleChange(key)}
              className="text-[8px] px-1.5 py-0.5 rounded transition-all"
              style={djStyle === key
                ? { background: 'rgba(201,169,110,0.15)', color: GOLD, fontWeight: 600 }
                : { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose}
          className="p-0.5 rounded transition-all hover:opacity-70 flex-shrink-0 ml-1"
          style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }}>
          <X className="w-3 h-3" />
        </button>
      </div>
      {/* 解说文案 */}
      <p className={`${isLandscape ? 'text-[13px]' : 'text-[12px]'} leading-relaxed`}
        style={{ color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)', textAlign: 'justify' }}>
        {script}
      </p>
      {/* 快捷对话 */}
      <div className="flex items-center gap-2 mt-3 pt-2.5"
        style={{ borderTop: '1px solid rgba(201,169,110,0.08)' }}>
        <input type="text" value={chatInput} onChange={(e) => onChatInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && chatInput.trim()) onQuickChat(); }}
          placeholder="AI音乐助手，继续聊点音乐"
          className="flex-1 bg-transparent outline-none text-[11px] px-0 py-1"
          style={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(201,169,110,0.15)' }}
          disabled={isChatLoading} />
        <button onClick={onQuickChat}
          disabled={!chatInput.trim() || isChatLoading}
          className="p-1 rounded disabled:opacity-20 transition-all"
          style={{ color: GOLD }}>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
