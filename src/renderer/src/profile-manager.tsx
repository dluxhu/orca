// The Profile Manager window's own React root. See src/main/app-profiles/profile-manager-window.ts.
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyStartupAppTheme } from './app-shell/appearance/use-app-theme-paint'
import { ProfileManager } from './components/profile-manager/ProfileManager'
import { translate } from './i18n/i18n'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'

let settings: GlobalSettings | null = null
try {
  settings = window.api.settings.getSync()
} catch {
  // The system theme stays.
}
applyStartupAppTheme(settings)
document.title = translate('profileManager.title', 'Orca Profile Manager')

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Profile Manager root element not found.')
}
createRoot(rootElement).render(
  <StrictMode>
    <ProfileManager />
  </StrictMode>
)
