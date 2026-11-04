import { Sparkles, Radio, Loader2, RefreshCw } from 'lucide-react';
import { GOLD } from './utils';
import { usePlayerStore } from '../../store/playerStore';

/**
 * AI 电台风格预设
 * - key: 用于 UI 高亮 / 持久化
 * - label: 卡片标题
 * - desc: 一句话描述
 * - prompt: 传给 LLM 的风格描述（拼接到推荐 prompt）
 *
 * 硬约束（每个 prompt 都自带）：必须有人声有歌词，严禁纯音乐/背景流/Lo-Fi/钢琴曲。
 */
const VOCAL_GUARD = '【硬性要求】只推荐有人声、有完整歌词的真实歌曲，严禁纯音乐/纯旋律/纯钢琴/纯演奏/Lo-Fi beats/白噪音/背景音乐/伴奏/Live 版/Remix。';

export const RADIO_PRESETS = [
  {
    key: 'focus', label: '工作', desc: '专注写东西，人声不抢戏',
    prompt: `场景：写代码/写方案/读书时听。风格：中速、节奏稳定、人声柔和不抢注意力的华语流行/民谣，旋律熟悉但不刺激。代表艺人池：朴树、李健、陈绮贞、老狼、蔡健雅、卢广仲、孙燕姿（中速曲）、陈奕迅（抒情曲）。${VOCAL_GUARD}`
  },
  {
    key: 'commute', label: '通勤', desc: '地铁路上，轻快律动',
    prompt: `场景：早晚高峰地铁/步行/开车通勤。风格：节奏轻快、情绪上扬、能跟着哼的华语/欧美流行，BPM 100-130 之间。代表艺人池：五月天、周杰伦（中快歌）、林俊杰、薛之谦、Maroon 5、Taylor Swift、Bruno Mars、张惠妹。${VOCAL_GUARD}`
  },
  {
    key: 'home', label: '居家', desc: '周末家里，温柔流行',
    prompt: `场景：周末在家做饭/晒太阳/收拾房间/和朋友闲聊。风格：温柔暖意、家常感的中文民谣和都市流行。代表艺人池：陈奕迅、孙燕姿、范晓萱、卢广仲、苏打绿、田馥甄、李宗盛、张悬。${VOCAL_GUARD}`
  },
  {
    key: 'midnight', label: '深夜', desc: '23 点之后，慢一点',
    prompt: `场景：深夜独处、写日记、失眠时听。风格：慢节奏、情绪饱满有故事感、有娓娓道来的叙事性歌词。代表艺人池：李志、万能青年旅店、雷光夏、陈绮贞、林忆莲、王菲（慢歌）、莫文蔚、张国荣（深情）。${VOCAL_GUARD}`
  },
  {
    key: 'nostalgia', label: '怀旧', desc: '90-00 年代回忆杀',
    prompt: `场景：想听小时候/学生时代的国民金曲。风格：1990-2010 年的华语经典，KTV 必点级别。代表艺人池：王菲、张国荣、邓丽君、黄家驹/Beyond、张学友、刘若英、孙燕姿、五月天、周杰伦（早期）、SHE、信乐团、任贤齐。${VOCAL_GUARD}`
  },
  {
    key: 'healing', label: '治愈', desc: '情绪低谷，温柔抚慰',
    prompt: `场景：情绪低落、需要被安慰的时候。风格：温柔包裹、有抚慰感的女声/男声民谣，歌词有"陪伴"和"理解"的力量。代表艺人池：陈绮贞、张悬、田馥甄、卢广仲、蔡健雅、陈奕迅（抒情）、孙燕姿（治愈曲）、苏打绿。${VOCAL_GUARD}`
  },
  {
    key: 'canto', label: '粤语', desc: '港乐金曲专题',
    prompt: `场景：纯粤语电台模式。风格：港乐黄金时代到当代粤语金曲。代表艺人池：陈奕迅、张学友、Beyond/黄家驹、谭咏麟、张国荣、王菲（粤语）、Twins、容祖儿、谢霆锋、卫兰、林子祥、达明一派、麦浚龙。所有歌曲必须是粤语演唱版本。${VOCAL_GUARD}`
  },
  {
    key: 'niche', label: '小众', desc: '不那么大众但很好听',
    prompt: `场景：听腻了排行榜，想发现宝藏。风格：独立民谣/文艺/独立音乐，传唱度中等但口碑极高。代表艺人池：万能青年旅店、陈鸿宇、钟立风、野孩子、低苦艾、好妹妹、宋冬野、马頔、程璧、张玮玮、周云蓬。避开过于地下的实验作品。${VOCAL_GUARD}`
  },
  {
    key: 'pop', label: '流行', desc: '当代华语主流',
    prompt: `场景：通用主流华语流行电台。风格：当代华语流行金曲，传唱度高、制作精良。代表艺人池：周杰伦、林俊杰、邓紫棋、薛之谦、毛不易、李荣浩、华晨宇、张惠妹、田馥甄、王力宏、陶喆、五月天。${VOCAL_GUARD}`
  },
  {
    key: 'hot', label: '热门', desc: '近年 KTV 必点',
    prompt: `场景：朋友聚会都能跟唱的近年热曲。风格：2018-2024 年传唱度爆表的华语金曲，KTV 点唱率高。代表艺人池：毛不易、李荣浩、薛之谦、林俊杰、华晨宇、邓紫棋、周深、单依纯、刘若英、五月天（近作）、孙燕姿（复出曲）。${VOCAL_GUARD}`
  },
] as const;

interface Props {
  isDark: boolean;
  onStart: (style: string, preset: string | null) => void;  // 启动电台
  onExit?: () => void;                                       // 退出电台（仅当前在电台模式时显示）
  isLoading?: boolean;                                       // 拉新中
  customInput: string;
  onCustomInputChange: (v: string) => void;
}

export default function AIRadioPanel({ isDark, onStart, onExit, isLoading, customInput, onCustomInputChange }: Props) {
  const radioMode = usePlayerStore((s) => s.radioMode);
  const radioStylePreset = usePlayerStore((s) => s.radioStylePreset);
  const radioStyle = usePlayerStore((s) => s.radioStyle);
  const radioRecommendedHistory = usePlayerStore((s) => s.radioRecommendedHistory);
  const clearRadioHistory = usePlayerStore((s) => s.clearRadioHistory);

  const inStation = radioMode === 'station';

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      {/* 标题区 */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4" style={{ color: GOLD }} />
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>AI 电台</h2>
        {inStation && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium ml-1" style={{
            background: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(201,169,110,0.2)',
            color: GOLD, border: `1px solid ${isDark ? 'rgba(201,169,110,0.3)' : 'rgba(201,169,110,0.4)'}`,
          }}>
            播放中 · {radioStyle?.length && radioStyle.length > 6 ? radioStyle.slice(0, 6) + '…' : (radioStyle || '自定义')}
          </span>
        )}
      </div>
      <p className="text-[11px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        基于你的长期偏好持续推荐，自动续流。挑一个风格立即开始，或者自由描述心情场景。
      </p>

      {/* 风格预设网格：10 个标签紧凑展示 */}
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {RADIO_PRESETS.map((p) => {
          const active = radioStylePreset === p.key && inStation;
          return (
            <button
              key={p.key}
              disabled={isLoading}
              onClick={() => onStart(p.prompt, p.key)}
              className="text-left rounded-lg px-2.5 py-2 transition-all"
              style={{
                background: active ? (isDark ? 'rgba(201,169,110,0.18)' : 'rgba(201,169,110,0.16)') : 'var(--card-bg)',
                border: `1px solid ${active ? 'rgba(201,169,110,0.5)' : 'var(--card-border)'}`,
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <Radio className="w-3 h-3" style={{ color: active ? GOLD : 'var(--text-icon)' }} />
                <span className="text-[12px] font-semibold" style={{ color: active ? GOLD : 'var(--text-primary)' }}>{p.label}</span>
              </div>
              <p className="text-[9.5px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>{p.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 自定义描述 */}
      <div className="mb-3">
        <label className="text-[10px] font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>自由描述（场景 / 心情 / 风格 / 艺人）</label>
        <textarea
          value={customInput}
          onChange={(e) => onCustomInputChange(e.target.value)}
          placeholder="例如：今晚加班很累，想要清凉一点的女声民谣"
          rows={2}
          className="w-full text-[12px] px-3 py-2 rounded-xl resize-none focus:outline-none"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          disabled={isLoading || !customInput.trim()}
          onClick={() => onStart(customInput.trim(), null)}
          className="mt-2 w-full py-2.5 rounded-xl text-[12px] font-semibold transition-all flex items-center justify-center gap-2"
          style={{
            background: customInput.trim() && !isLoading ? GOLD : 'var(--card-bg)',
            color: customInput.trim() && !isLoading ? '#fff' : 'var(--text-tertiary)',
            border: `1px solid ${customInput.trim() && !isLoading ? GOLD : 'var(--card-border)'}`,
            cursor: isLoading ? 'wait' : (customInput.trim() ? 'pointer' : 'not-allowed'),
          }}
        >
          {isLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />正在调度电台…</> : <><Sparkles className="w-3.5 h-3.5" />用这个描述启动电台</>}
        </button>
      </div>

      {/* 电台运行中：退出按钮 */}
      {inStation && onExit && (
        <button
          onClick={onExit}
          className="w-full mt-2 py-2 rounded-xl text-[11px] font-medium transition-all"
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--card-border)',
          }}
        >
          退出电台模式（保留当前队列）
        </button>
      )}

      {/* 推荐新鲜度：历史记录 + 重置 */}
      {radioRecommendedHistory.length > 0 && (
        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            已累积推荐 {radioRecommendedHistory.length} 首不同歌曲，持续挖掘新鲜内容
          </span>
          <button
            onClick={clearRadioHistory}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all hover:opacity-80"
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--card-border)',
            }}
          >
            <RefreshCw className="w-3 h-3" />
            重置
          </button>
        </div>
      )}

      {/* 说明 */}
      <div className="mt-4 p-3 rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          电台会基于你的收藏、播放历史、偏好档案持续生成推荐。每播完一首自动续上下一首。<br />
          已推荐过的歌曲不会重复推荐（跨会话记忆），保证每次打开都有新鲜感。<br />
          点不喜欢会立刻切歌并永久排除该曲。退出电台后队列保留，可随时再次进入。
        </p>
      </div>
    </div>
  );
}
