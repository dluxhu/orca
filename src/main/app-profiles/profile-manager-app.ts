// Profile Manager mode: the main process of the nested Profile Manager app. It shows only the
// Profile Manager window. It starts no main window, runtime, agents, serve or updater, and takes
// no profile lock. See docs/fork/profiles-design.md, section 4.
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, Menu } from 'electron'
import {
  appProfilesRoot,
  PROFILE_MANAGER_APP_NAME,
  PROFILE_MANAGER_USER_DATA
} from '../../shared/app-profiles/app-profile-paths'
import { translateMain } from '../i18n/main-i18n'
import { isProfileManagerApp } from './app-profile'
import { profilesMenuItems, registerProfileManagerIpc, startProfilesMenu } from './profile-manager'
import { openProfileManagerWindow, PROFILE_MANAGER_NEW_ARG } from './profile-manager-window'
import { PROFILE_MANAGER_SMOKE_ENV, runProfileManagerSmoke } from './profile-manager-smoke'

function applyMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: translateMain('menu.profiles', 'Profiles'), submenu: profilesMenuItems() },
      { role: 'windowMenu' }
    ])
  )
}

/** Starts Profile Manager mode in the Profile Manager app. False in every other app. */
export function runProfileManagerApp(): boolean {
  if (!isProfileManagerApp()) {
    return false
  }
  app.setPath('userData', join(appProfilesRoot(), PROFILE_MANAGER_USER_DATA))
  // The app menu says "Quit Orca Profile Manager". Electron reads the name from package.json.
  app.setName(PROFILE_MANAGER_APP_NAME)
  // `open` starts the app once. This lock also covers a direct start of the executable.
  const smoke = Boolean(process.env[PROFILE_MANAGER_SMOKE_ENV])
  if (!app.requestSingleInstanceLock()) {
    if (smoke) {
      writeSync(1, 'profile-manager-smoke: fail already running\n')
    }
    app.exit(smoke ? 1 : 0)
    return true
  }
  if (!smoke) {
    app.on('second-instance', (_event, argv) =>
      openProfileManagerWindow({ startNew: argv.includes(PROFILE_MANAGER_NEW_ARG) })
    )
    app.on('activate', () => openProfileManagerWindow())
    app.on('window-all-closed', () => app.quit())
  }
  registerProfileManagerIpc()
  // A renderer blocks on a sync call until it gets a reply. This mode loads no settings, so the
  // window keeps the system theme. It has no browser guests to discard.
  ipcMain.on('settings:get-sync', (event) => {
    event.returnValue = null
  })
  ipcMain.on('browser:reserveGuestDiscard', (event) => {
    event.returnValue = false
  })
  void app.whenReady().then(() => {
    if (smoke) {
      app.dock?.hide()
      runProfileManagerSmoke(
        () => openProfileManagerWindow({ hidden: true }),
        (line, code) => {
          // Sync: stdout to a pipe is async on macOS, and app.exit would drop the line.
          writeSync(1, `${line}\n`)
          app.exit(code)
        }
      )
      return
    }
    startProfilesMenu(applyMenu)
    openProfileManagerWindow({ startNew: process.argv.includes(PROFILE_MANAGER_NEW_ARG) })
  })
  return true
}
