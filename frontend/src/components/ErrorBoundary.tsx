import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

/** 根级错误边界：渲染异常时给出可恢复界面，避免整页白屏 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || '未知错误' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 渲染异常', error.message, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-6" style={{ background: 'var(--bg-primary, #050505)' }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertTriangle className="w-6 h-6" style={{ color: '#ef4444' }} />
        </div>
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary, #fff)' }}>MusicBuddy 遇到了一个问题</h1>
        <p className="text-xs text-center max-w-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {this.state.message}。你的收藏与播放记录保存在本地，不会丢失。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90"
          style={{ background: '#c9a96e', color: '#0a0a0a' }}
        >
          <RefreshCw className="w-4 h-4" /> 重新加载
        </button>
      </div>
    );
  }
}
