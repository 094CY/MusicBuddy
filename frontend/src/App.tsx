import { useEffect, useState } from 'react'
import PlayerPage from './pages/PlayerPage'
import PasswordGate from './components/PasswordGate'
import ErrorBoundary from './components/ErrorBoundary'
import GlobalOverlays from './components/GlobalOverlays'
import CommandPalette from './components/CommandPalette'
import SettingsPanel from './components/SettingsPanel'
import { loadPreferences, type Preferences } from './lib/preferences'

// 设置面板由全局事件驱动，横竖版与命令面板都能打开
export function openSettings() {
  window.dispatchEvent(new Event('musicbuddy:open-settings'))
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences())

  useEffect(() => {
    const open = () => setSettingsOpen(true)
    const onPrefChange = (e: Event) => {
      const next = (e as CustomEvent<Preferences>).detail
      if (next) setPreferences(next)
    }
    window.addEventListener('musicbuddy:open-settings', open)
    window.addEventListener('musicbuddy:preferences-changed', onPrefChange)
    return () => {
      window.removeEventListener('musicbuddy:open-settings', open)
      window.removeEventListener('musicbuddy:preferences-changed', onPrefChange)
    }
  }, [])

  return (
    <ErrorBoundary>
      <PasswordGate>
        <PlayerPage preferences={preferences} onOpenSettings={() => setSettingsOpen(true)} />
        <GlobalOverlays />
        <CommandPalette onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onPreferencesChange={setPreferences}
        />
      </PasswordGate>
    </ErrorBoundary>
  )
}

export default App
