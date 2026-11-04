import { Play, Sparkles, ListMusic, Heart, History, Search } from 'lucide-react';
import { GOLD } from './utils';

interface ParsedAction {
  type: 'play' | 'recommend' | 'open_panel';
  params: Record<string, string>;
}

/** 从 AI 回复文本解析 ACTION 指令 */
function parseChatContent(raw: string): { text: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const actionRegex = /\[ACTION:([^|\]]+)((?:\|[^=\]]+=[^\]]*)*)\]/g;
  const cleanedText = raw.replace(actionRegex, (_match, type, paramsStr) => {
    const params: Record<string, string> = {};
    const paramPairs = (paramsStr as string).split('|').filter(Boolean);
    for (const p of paramPairs) {
      const [k, v] = p.split('=');
      if (k && v !== undefined) params[k.trim()] = v.trim();
    }
    if (type === 'play' || type === 'recommend' || type === 'open_panel') {
      actions.push({ type: type as ParsedAction['type'], params });
    }
    return '';
  }).trim();

  // 清洗 Markdown + 兜底清括号注解（即使后端漏了）
  const finalText = cleanedText
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    // 行内/独立的圆括号注解（中英文），避免误伤 [ACTION] 协议块（已被前面剥离）
    .replace(/^[（(][^（()）]{0,80}[）)]\s*$/gm, '')
    .replace(/\s*[（(][^（()）]{0,80}[）)](?=\s|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: finalText, actions };
}

/**
 * 提取文本中的"《歌名》艺人"组合，并把消息切分成 token 序列：
 * 普通文字段或 song token。
 * 推断艺人规则（按优先级）：
 *  1) 紧邻歌名前的"X的《歌名》"
 *  2) 紧邻歌名后的"《歌名》(X)"或"《歌名》——X"或"《歌名》X"（X 为 2-15 个非标点字符）
 *  3) 兜底：留空，前端按只用歌名搜索
 */
type Token =
  | { kind: 'text'; value: string }
  | { kind: 'song'; song: string; artist: string };

const SONG_REGEX = /《([^《》\n]{1,40})》/g;
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  const matches: { idx: number; len: number; song: string }[] = [];
  let m: RegExpExecArray | null;
  // 重置正则状态
  SONG_REGEX.lastIndex = 0;
  while ((m = SONG_REGEX.exec(text)) !== null) {
    matches.push({ idx: m.index, len: m[0].length, song: m[1] });
  }
  if (!matches.length) return [{ kind: 'text', value: text }];

  for (const match of matches) {
    if (match.idx > lastIndex) {
      tokens.push({ kind: 'text', value: text.slice(lastIndex, match.idx) });
    }
    // 推断艺人
    const before = text.slice(Math.max(0, match.idx - 20), match.idx);
    const after = text.slice(match.idx + match.len, match.idx + match.len + 25);
    let artist = '';
    // 1) 前缀 "X的"
    const beforeMatch = before.match(/([\u4e00-\u9fa5A-Za-z0-9·\-\s]{2,15})的$/);
    if (beforeMatch) {
      artist = beforeMatch[1].trim();
    } else {
      // 2) 后缀 "(X)" / "—— X" / "- X" / "by X"
      const afterMatch = after.match(/^[\s]*[（(]([^（()）]{2,15})[）)]/)
        || after.match(/^[\s]*(?:——|--|—|-|by\s+)([\u4e00-\u9fa5A-Za-z0-9·\s]{2,15})/i);
      if (afterMatch) artist = afterMatch[1].trim();
    }
    tokens.push({ kind: 'song', song: match.song, artist });
    lastIndex = match.idx + match.len;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

export interface ChatMessageRendererProps {
  content: string;
  isDark: boolean;
  onPlaySong: (name: string, artist: string) => void;
  onPlayBatch?: (items: { song: string; artist: string }[]) => void;
  onRecommend: (prompt: string) => void;
  onOpenPanel: (panel: string) => void;
  variant?: 'portrait' | 'landscape';
}

export default function ChatMessageRenderer({ content, isDark, onPlaySong, onPlayBatch, onRecommend, onOpenPanel, variant = 'portrait' }: ChatMessageRendererProps) {
  const { text, actions } = parseChatContent(content);
  const textSize = variant === 'landscape' ? 'text-[13px]' : 'text-[13px]';
  const tokens = tokenize(text);

  // 收集"消息中提到的所有歌曲"作为底部快捷播放区（与 ACTION 合并去重）
  const inlineSongs = tokens.filter((t): t is Extract<Token, { kind: 'song' }> => t.kind === 'song');
  const actionPlays = actions.filter((a) => a.type === 'play');
  // 去重（song+artist 组合）
  const seen = new Set<string>();
  const allPlayables: { song: string; artist: string }[] = [];
  for (const a of actionPlays) {
    const key = `${a.params.song}|${a.params.artist || ''}`;
    if (!seen.has(key) && a.params.song) {
      seen.add(key);
      allPlayables.push({ song: a.params.song, artist: a.params.artist || '' });
    }
  }
  for (const s of inlineSongs) {
    const key = `${s.song}|${s.artist}`;
    if (!seen.has(key)) {
      seen.add(key);
      allPlayables.push({ song: s.song, artist: s.artist });
    }
  }

  const panelLabel: Record<string, { label: string; Icon: any }> = {
    favorites: { label: '打开收藏', Icon: Heart },
    history: { label: '打开历史', Icon: History },
    playlist: { label: '打开播放列表', Icon: ListMusic },
    search: { label: '打开搜索', Icon: Search },
  };

  return (
    <div>
      {/* 正文：歌名《》自动渲染为可点击金色文字 */}
      <div className={`whitespace-pre-wrap ${textSize} leading-relaxed`}>
        {tokens.map((tk, i) => {
          if (tk.kind === 'text') return <span key={i}>{tk.value}</span>;
          return (
            <button
              key={i}
              onClick={() => onPlaySong(tk.song, tk.artist)}
              className="inline-flex items-center align-baseline transition-all hover:opacity-80"
              style={{
                color: GOLD,
                fontWeight: 600,
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                padding: '0 2px',
                textDecoration: 'underline',
                textDecorationColor: 'rgba(201,169,110,0.4)',
                textUnderlineOffset: '2px',
              }}
              title={`点击播放《${tk.song}》${tk.artist ? '· ' + tk.artist : ''}`}
            >
              《{tk.song}》
            </button>
          );
        })}
      </div>

      {/* 底部快捷操作区 */}
      {(allPlayables.length > 0 || actions.some((a) => a.type !== 'play')) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {/* 全部播放（多首时） */}
          {allPlayables.length > 1 && (
            <button
              onClick={() => {
                if (onPlayBatch) onPlayBatch(allPlayables);
                else allPlayables.forEach((p) => onPlaySong(p.song, p.artist));
              }}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all hover:scale-105"
              style={{ background: GOLD, color: '#fff', boxShadow: '0 2px 10px rgba(201,169,110,0.35)' }}
            >
              <Play className="w-3 h-3" fill="#fff" />
              <span>把这 {allPlayables.length} 首加入队列并播放</span>
            </button>
          )}

          {/* 单首：单按钮直接播放 */}
          {allPlayables.length === 1 && (
            <button
              onClick={() => onPlaySong(allPlayables[0].song, allPlayables[0].artist)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all hover:scale-105"
              style={{ background: GOLD, color: '#fff', boxShadow: '0 2px 10px rgba(201,169,110,0.35)' }}
            >
              <Play className="w-3 h-3" fill="#fff" />
              <span>播放《{allPlayables[0].song}》</span>
              {allPlayables[0].artist && <span className="opacity-80">· {allPlayables[0].artist}</span>}
            </button>
          )}

          {/* 推荐 / 打开面板 ACTION */}
          {actions.map((act, i) => {
            if (act.type === 'recommend') {
              const prompt = act.params.prompt || '';
              return (
                <button key={`rec-${i}`} onClick={() => onRecommend(prompt)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all hover:scale-105"
                  style={{
                    background: 'rgba(201,169,110,0.15)',
                    color: isDark ? 'rgba(220,190,130,0.95)' : 'rgba(130,100,40,0.95)',
                    border: `1px solid ${isDark ? 'rgba(201,169,110,0.35)' : 'rgba(201,169,110,0.45)'}`,
                  }}>
                  <Sparkles className="w-3 h-3" />
                  <span>重新推荐{prompt ? `（${prompt}）` : ''}</span>
                </button>
              );
            }
            if (act.type === 'open_panel' && act.params.panel) {
              const cfg = panelLabel[act.params.panel];
              if (!cfg) return null;
              const { label, Icon } = cfg;
              return (
                <button key={`panel-${i}`} onClick={() => onOpenPanel(act.params.panel)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all hover:scale-105"
                  style={{
                    background: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--card-border)',
                  }}>
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
