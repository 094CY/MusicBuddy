/** 本地偏好：与服务端配置分开，全部存 localStorage，界面修改即时生效 */

const KEY = 'musicbuddy-preferences';

export type ThemePreference = 'dark' | 'light' | 'system';
export type MusicPlatform = 'netease' | 'qq' | 'youtube';

export interface Preferences {
  theme: ThemePreference;
  enabledPlatforms: MusicPlatform[];
  showTranslation: boolean;
  ttsEnabled: boolean;
  djStyle: 'night' | 'energy' | 'literary';
  searchLimit: number;
  showLyric: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  enabledPlatforms: ['netease', 'qq', 'youtube'],
  showTranslation: true,
  ttsEnabled: false,
  djStyle: 'night',
  searchLimit: 30,
  showLyric: true,
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const platforms = Array.isArray(parsed.enabledPlatforms)
      ? parsed.enabledPlatforms.filter((p): p is MusicPlatform => ['netease', 'qq', 'youtube'].includes(p))
      : DEFAULT_PREFERENCES.enabledPlatforms;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark' ? parsed.theme : 'dark',
      enabledPlatforms: platforms.length > 0 ? platforms : ['netease'],
      showTranslation: typeof parsed.showTranslation === 'boolean' ? parsed.showTranslation : true,
      ttsEnabled: typeof parsed.ttsEnabled === 'boolean' ? parsed.ttsEnabled : false,
      djStyle: parsed.djStyle === 'energy' || parsed.djStyle === 'literary' ? parsed.djStyle : 'night',
      searchLimit: typeof parsed.searchLimit === 'number' && parsed.searchLimit >= 10 && parsed.searchLimit <= 60
        ? parsed.searchLimit : 30,
      showLyric: typeof parsed.showLyric === 'boolean' ? parsed.showLyric : true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(p: Preferences): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** 当前应生效的主题：跟随系统时实时判断 */
export function resolveTheme(p: ThemePreference): 'dark' | 'light' {
  if (p === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return p;
}

export function platformQuery(platforms: MusicPlatform[]): string {
  return (platforms.length > 0 ? platforms : ['netease']).join(',');
}
