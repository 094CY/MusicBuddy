import { useEffect, useState, useRef } from 'react';
import { Settings, X, Save, Eye, EyeOff, RotateCcw, Download, Upload, Keyboard, Server, Palette, Music2, Database, Check } from 'lucide-react';
import { apiFetch, notify } from '../config';
import { exportBackup, parseBackup } from '../lib/dataBackup';
import { usePlayerStore } from '../store/playerStore';
import { GOLD } from './player/utils';
import {
  loadPreferences, savePreferences, DEFAULT_PREFERENCES, platformQuery,
  type Preferences, type MusicPlatform, type ThemePreference,
} from '../lib/preferences';

interface Props {
  open: boolean;
  onClose: () => void;
  onPreferencesChange?: (p: Preferences) => void;
}

interface ServerValues {
  LLM_API_KEY_SET?: boolean;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  TTS_PROVIDER?: string;
  TTS_API_KEY_SET?: boolean;
  TTS_BASE_URL?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
  YTMUSIC_API_KEY_SET?: boolean;
  [key: string]: unknown;
}

interface ServerStatus {
  llmConfigured: boolean;
  ttsEnabled: boolean;
  ttsProvider: string;
}

const PLATFORMS: { id: MusicPlatform; label: string; note: string }[] = [
  { id: 'netease', label: '网易云', note: '曲库最全，歌词匹配最准' },
  { id: 'qq', label: 'QQ 音乐', note: '补充华语与独家版权' },
  { id: 'youtube', label: 'YouTube Music', note: '依赖本地 yt-dlp，桌面端可用' },
];

/** 可视化设置中心：服务配置、播放偏好、外观、数据与快捷键 */
export default function SettingsPanel({ open, onClose, onPreferencesChange }: Props) {
  const [pref, setPref] = useState<Preferences>(() => loadPreferences());
  const [server, setServer] = useState<ServerValues>({});
  const [status, setStatus] = useState<ServerStatus>({ llmConfigured: false, ttsEnabled: false, ttsProvider: 'none' });
  const [form, setForm] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPref(loadPreferences());
    setLoading(true);
    apiFetch('/api/settings', { timeoutMs: 8000 })
      .then((r) => r.json())
      .then((data) => {
        setServer(data.values || {});
        setStatus(data.status || status);
        const f: Record<string, string> = {};
        for (const k of ['LLM_BASE_URL', 'LLM_MODEL', 'TTS_PROVIDER', 'TTS_BASE_URL', 'TTS_MODEL', 'TTS_VOICE']) {
          f[k] = String((data.values || {})[k] || '');
        }
        setForm(f);
      })
      .catch(() => notify('读取服务配置失败，请检查后端是否运行', 'error'))
      .finally(() => setLoading(false));
  }, [open]);

  const updatePref = (patch: Partial<Preferences>) => {
    const next = { ...pref, ...patch };
    setPref(next);
    savePreferences(next);
    onPreferencesChange?.(next);
    window.dispatchEvent(new CustomEvent('musicbuddy:preferences-changed', { detail: next }));
  };

  const togglePlatform = (id: MusicPlatform) => {
    const has = pref.enabledPlatforms.includes(id);
    const next = has ? pref.enabledPlatforms.filter((p) => p !== id) : [...pref.enabledPlatforms, id];
    if (next.length === 0) { notify('至少保留一个音源', 'error'); return; }
    updatePref({ enabledPlatforms: next });
  };

  const saveServer = async () => {
    setSaving(true);
    try {
      const values: Record<string, string> = { ...form };
      // 密钥留空表示不修改；有输入才提交
      const secretInputs = document.querySelectorAll<HTMLInputElement>('[data-secret-key]');
      secretInputs.forEach((el) => {
        if (el.value) values[el.dataset.secretKey || ''] = el.value;
      });
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
        timeoutMs: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setStatus(data.status || status);
      setServer((prev) => ({ ...prev, ...values }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      notify('服务配置已保存并生效', 'success');
    } catch (e: any) {
      notify(`保存失败：${e.message || '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetPref = () => {
    setPref({ ...DEFAULT_PREFERENCES });
    savePreferences({ ...DEFAULT_PREFERENCES });
    onPreferencesChange?.({ ...DEFAULT_PREFERENCES });
    notify('偏好已恢复默认', 'success');
  };

  const handleExport = () => {
    const s = usePlayerStore.getState();
    exportBackup({
      favorites: s.favorites, playHistory: s.playHistory, chatMessages: s.chatMessages,
      searchHistory: s.searchHistory, radioRecommendedHistory: s.radioRecommendedHistory,
      playMode: s.playMode, volume: s.volume,
    });
    notify('已导出个人数据', 'success');
  };

  const handleImport = async (file: File) => {
    try {
      const data = parseBackup(await file.text());
      usePlayerStore.setState({
        favorites: data.favorites, playHistory: data.playHistory, chatMessages: data.chatMessages,
        searchHistory: data.searchHistory, radioRecommendedHistory: data.radioRecommendedHistory,
        playMode: data.playMode, volume: data.volume, lastCleared: null,
      });
      notify(`已导入 ${data.favorites.length} 首收藏`, 'success');
    } catch (e: any) {
      notify(`导入失败：${e.message || '文件格式不正确'}`, 'error');
    }
  };

  if (!open) return (
    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-hidden="true" />
  );

  const inputStyle = {
    background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)',
  };
  const labelStyle = { color: 'var(--text-secondary)' };

  const Field = ({ label, fieldKey, placeholder, secret, hint }: {
    label: string; fieldKey: string; placeholder?: string; secret?: boolean; hint?: string;
  }) => (
    <label className="block">
      <span className="text-[11px] font-medium" style={labelStyle}>{label}</span>
      <div className="relative mt-1">
        <input
          data-secret-key={secret ? fieldKey : undefined}
          type={secret && !showSecrets ? 'password' : 'text'}
          defaultValue={secret ? '' : (form[fieldKey] || '')}
          onChange={(e) => { if (!secret) setForm((f) => ({ ...f, [fieldKey]: e.target.value })); }}
          placeholder={secret ? (server[`${fieldKey}_SET`] ? '已配置，留空保持不变' : '未配置') : placeholder}
          className="w-full px-3 py-2 rounded-xl text-[12px] outline-none pr-9"
          style={inputStyle}
          autoComplete="off"
        />
      </div>
      {hint && <span className="block mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{hint}</span>}
    </label>
  );

  const Section = ({ icon: Icon, title, desc, children }: {
    icon: typeof Server; title: string; desc: string; children: React.ReactNode;
  }) => (
    <section className="rounded-2xl p-4 mb-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="flex items-center gap-2.5 mb-1">
        <Icon className="w-4 h-4" style={{ color: GOLD }} />
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      </div>
      <p className="text-[10px] mb-3" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      {children}
    </section>
  );

  const Toggle = ({ label, note, checked, onChange }: {
    label: string; note?: string; checked: boolean; onChange: (v: boolean) => void;
  }) => (
    <button onClick={() => onChange(!checked)} role="switch" aria-checked={checked}
      className="w-full flex items-center justify-between py-2 text-left">
      <span>
        <span className="block text-[12px]" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {note && <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{note}</span>}
      </span>
      <span className="w-9 h-5 rounded-full flex-shrink-0 transition-all relative"
        style={{ background: checked ? GOLD : 'var(--hover-bg)', border: '1px solid var(--card-border)' }}>
        <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
          style={{ left: checked ? '18px' : '2px' }} />
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />

      <div className="w-full max-w-lg max-h-[86vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in"
        style={{ background: 'var(--slide-panel-bg)', border: '1px solid var(--panel-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
        role="dialog" aria-modal="true" aria-label="设置">
        <div className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--card-border)' }}>
          <Settings className="w-4 h-4" style={{ color: GOLD }} />
          <h2 className="flex-1 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: status.llmConfigured ? 'rgba(80,200,120,0.12)' : 'var(--hover-bg)',
              color: status.llmConfigured ? '#4ac47e' : 'var(--text-tertiary)' }}>
            AI {status.llmConfigured ? '已配置' : '未配置'}
          </span>
          <button onClick={onClose} aria-label="关闭设置"><X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-center text-[11px] py-4" style={{ color: 'var(--text-tertiary)' }}>正在读取配置…</p>}

          <Section icon={Server} title="AI 服务" desc="任意兼容 OpenAI 接口的服务均可接入，保存后立即生效，无需重启或改代码。">
            <div className="space-y-2.5">
              <Field label="接口地址" fieldKey="LLM_BASE_URL" placeholder="https://your-service/v1" />
              <Field label="模型名" fieldKey="LLM_MODEL" placeholder="留空自动探测可用模型" />
              <Field label="API Key" fieldKey="LLM_API_KEY" secret hint="密钥只保存在本机用户目录，不会回显、不会上传" />
            </div>
          </Section>

          <Section icon={Music2} title="语音播报" desc="DJ 解说所需。不配置时播报自动关闭，不影响播放。">
            <div className="space-y-2.5">
              <label className="block">
                <span className="text-[11px] font-medium" style={labelStyle}>接入方式</span>
                <select value={form.TTS_PROVIDER || ''} onChange={(e) => setForm((f) => ({ ...f, TTS_PROVIDER: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] outline-none" style={inputStyle}>
                  <option value="">自动检测</option>
                  <option value="openai-compatible">通用 HTTP 接口</option>
                  <option value="sdk">SDK 适配器</option>
                  <option value="none">关闭语音播报</option>
                </select>
              </label>
              <Field label="接口地址" fieldKey="TTS_BASE_URL" placeholder="留空则复用 AI 服务地址" />
              <Field label="语音模型" fieldKey="TTS_MODEL" placeholder="可选" />
              <Field label="音色" fieldKey="TTS_VOICE" placeholder="可选" />
              <Field label="API Key" fieldKey="TTS_API_KEY" secret hint="通用接口使用；留空保持不变" />
            </div>
          </Section>

          <Section icon={Palette} title="外观与播放" desc="这些偏好保存在本机，修改即刻生效。">
            <label className="block mb-3">
              <span className="text-[11px] font-medium" style={labelStyle}>主题</span>
              <div className="flex gap-1.5 mt-1.5">
                {([['dark', '深色'], ['light', '浅色'], ['system', '跟随系统']] as [ThemePreference, string][]).map(([v, label]) => (
                  <button key={v} onClick={() => updatePref({ theme: v })}
                    className="flex-1 py-2 rounded-xl text-[11px] font-medium transition-all"
                    style={{ background: pref.theme === v ? GOLD : 'var(--hover-bg)',
                      color: pref.theme === v ? '#0a0a0a' : 'var(--text-secondary)',
                      border: '1px solid var(--card-border)' }}>{label}</button>
                ))}
              </div>
            </label>

            <div className="mb-3">
              <span className="text-[11px] font-medium" style={labelStyle}>启用的音源</span>
              <div className="mt-1.5 space-y-1">
                {PLATFORMS.map((p) => (
                  <button key={p.id} onClick={() => togglePlatform(p.id)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all"
                    style={{ border: '1px solid var(--card-border)',
                      background: pref.enabledPlatforms.includes(p.id) ? 'rgba(201,169,110,0.1)' : 'transparent' }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: pref.enabledPlatforms.includes(p.id) ? GOLD : 'var(--hover-bg)' }}>
                      {pref.enabledPlatforms.includes(p.id) && <Check className="w-3 h-3" style={{ color: '#0a0a0a' }} />}
                    </span>
                    <span className="flex-1">
                      <span className="block text-[12px]" style={{ color: 'var(--text-primary)' }}>{p.label}</span>
                      <span className="block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{p.note}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                当前检索：{platformQuery(pref.enabledPlatforms)}
              </p>
            </div>

            <label className="block mb-2">
              <span className="text-[11px] font-medium" style={labelStyle}>每平台搜索条数：{pref.searchLimit}</span>
              <input type="range" min={10} max={60} step={5} value={pref.searchLimit}
                onChange={(e) => updatePref({ searchLimit: Number(e.target.value) })} className="w-full mt-2" />
            </label>

            <div className="border-t pt-1" style={{ borderColor: 'var(--card-border)' }}>
              <Toggle label="DJ 语音播报" note="切歌时生成解说并朗读" checked={pref.ttsEnabled} onChange={(v) => updatePref({ ttsEnabled: v })} />
              <Toggle label="显示翻译歌词" note="有译文时在主歌词下显示小字" checked={pref.showTranslation} onChange={(v) => updatePref({ showTranslation: v })} />
              <Toggle label="显示歌词区" checked={pref.showLyric} onChange={(v) => updatePref({ showLyric: v })} />
            </div>
            <button onClick={() => setShowSecrets((v) => !v)} className="hidden" aria-hidden="true" />
          </Section>

          <Section icon={Database} title="数据管理" desc="收藏、历史与偏好都保存在本机，可随时备份或迁移。">
            <div className="flex gap-2">
              <button onClick={handleExport} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium"
                style={{ background: 'var(--hover-bg)', border: '1px solid var(--card-border)', color: 'var(--text-primary)' }}>
                <Download className="w-3.5 h-3.5" /> 导出数据
              </button>
              <button onClick={() => fileRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium"
                style={{ background: 'var(--hover-bg)', border: '1px solid var(--card-border)', color: 'var(--text-primary)' }}>
                <Upload className="w-3.5 h-3.5" /> 导入数据
              </button>
              <button onClick={resetPref} className="px-3 flex items-center justify-center rounded-xl"
                style={{ background: 'var(--hover-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)' }}
                title="恢复默认偏好"><RotateCcw className="w-3.5 h-3.5" /></button>
            </div>
          </Section>

          <Section icon={Keyboard} title="快捷键" desc="输入框聚焦时自动避让，不会误触。">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <span>空格 · 播放 / 暂停</span><span>← → · 快退 / 快进</span>
              <span>⌘K · 命令面板</span><span>L · 收藏当前歌曲</span>
              <span>⌘Z · 撤销清空</span><span>⌘, · 打开设置</span>
              <span>Esc · 关闭面板</span><span>/ · 快速搜索</span>
            </div>
          </Section>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--card-border)' }}>
          <button onClick={() => setShowSecrets((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px]"
            style={{ color: 'var(--text-secondary)', background: 'var(--hover-bg)' }}>
            {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showSecrets ? '隐藏' : '显示'}密钥
          </button>
          <span className="flex-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            配置写入本机用户目录，不进代码仓库
          </span>
          <button onClick={saveServer} disabled={saving || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: savedFlash ? '#4ac47e' : GOLD, color: '#0a0a0a' }}>
            {savedFlash ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {savedFlash ? '已保存' : saving ? '保存中…' : '保存服务配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
