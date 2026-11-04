import { useState, useEffect, useCallback } from 'react';
import { Lock, Music2 } from 'lucide-react';
import { getAccessPassword, setAccessPassword, clearAccessPassword, apiFetch } from '../config';

interface PasswordGateProps {
  children: React.ReactNode;
}

interface AuthCheck {
  passwordRequired: boolean;
  authenticated: boolean;
}

export default function PasswordGate({ children }: PasswordGateProps) {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      // 唯一鉴权判据：后端明确告知是否需要密码、当前凭据是否有效
      const res = await apiFetch('/api/auth/check', { method: 'GET', timeoutMs: 5000 });
      if (res.status === 403) { setIsAuthed(false); return; }
      const data = await res.json() as AuthCheck;
      if (!data.passwordRequired) { setIsAuthed(true); return; }

      const saved = getAccessPassword();
      if (saved) {
        const verify = await apiFetch('/api/auth/check', {
          method: 'GET',
          headers: { 'x-access-password': saved },
          timeoutMs: 5000,
        });
        const verified = await verify.json() as AuthCheck;
        if (verified.authenticated) { setIsAuthed(true); return; }
        clearAccessPassword();
      }
      setIsAuthed(false);
    } catch {
      // 后端离线时放行：桌面端 / 本地开发场景，播放功能本身不依赖鉴权接口
      setIsAuthed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 运行期任何接口返回 403（密码被改 / 过期）→ 重新弹出密码门
  useEffect(() => {
    const onAuthRequired = () => { setError('访问状态已失效，请重新输入'); setIsAuthed(false); setIsLoading(false); };
    window.addEventListener('musicbuddy:auth-required', onAuthRequired);
    return () => window.removeEventListener('musicbuddy:auth-required', onAuthRequired);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setError('');
    try {
      const res = await apiFetch('/api/auth/check', {
        method: 'GET',
        headers: { 'x-access-password': input.trim() },
        timeoutMs: 5000,
      });
      const data = await res.json() as AuthCheck;
      if (!data.authenticated) { setError('密码错误'); return; }
      setAccessPassword(input.trim());
      setInput('');
      setIsAuthed(true);
    } catch {
      setError('验证失败，请检查网络');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary, #050505)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(201,169,110,0.12)', border: '1px solid rgba(201,169,110,0.25)' }}>
            <Music2 className="w-5 h-5" style={{ color: '#c9a96e' }} />
          </div>
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#c9a96e', borderTopColor: 'transparent' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>MusicBuddy 启动中…</span>
        </div>
      </div>
    );
  }

  if (isAuthed) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-screen px-6" style={{ background: 'var(--bg-primary, #050505)' }}>
      <div className="flex flex-col items-center gap-6 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <img src="./icons/icon-192.png" alt="" className="w-10 h-10 rounded-xl" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-xl font-bold" style={{ color: 'var(--text-primary, #ffffff)' }}>MusicBuddy</span>
        </div>

        <div className="w-full rounded-2xl p-6 space-y-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" style={{ color: '#c9a96e' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>请输入访问密码</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="访问密码"
              aria-label="访问密码"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
              style={{
                background: 'var(--hover-bg)',
                border: `1px solid ${error ? '#ef4444' : 'var(--card-border)'}`,
                color: 'var(--text-primary)',
              }}
              autoFocus
            />
            {error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: '#c9a96e', color: '#0a0a0a' }}
            >
              进入
            </button>
          </form>
        </div>

        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          MusicBuddy 访问验证
        </p>
      </div>
    </div>
  );
}
