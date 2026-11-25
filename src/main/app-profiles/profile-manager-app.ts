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
import { isProfileManagerApp, ownBundleDisplayName } from './app-profile'
import { profilesMenuItems, registerProfileManagerIpc, startProfilesMenu } from './profile-manager'
import { openProfileManagerWindow, PROFILE_MANAGER_NEW_ARG } from './profile-manager-window'
import { PROFILE_MANAGER_SMOKE_ENV, runProfileManagerSmoke } from './profile-manager-smoke'

/**
 * The app menu with the bundle's display name ("Orca @dLux Profile Manager" in the fork). The
 * app name stays PROFILE_MANAGER_APP_NAME: it selects the Keychain item.
 */
export function profileManagerAppMenu(name: string): Electron.MenuItemConstructorOptions {
  const named = (key: string, fallback: string): string =>
    translateMain(key, fallback).replace('Orca', name)
  return {
    label: name,
    submenu: [
      { role: 'about', label: named('menu.about', 'About Orca') },
      { type: 'separator' },
      { role: 'services', label: translateMain('menu.services', 'Services') },
      { type: 'separator' },
      { role: 'hide', label: named('menu.hide', 'Hide Orca') },
      { role: 'hideOthers', label: translateMain('menu.hideOthers', 'Hide Others') },
      { role: 'unhide', label: translateMain('menu.unhide', 'Show All') },
      { type: 'separator' },
      { role: 'quit', label: translateMain('menu.quitApp', `Quit ${name}`, { appName: name }) }
    ]
  }
}

function applyMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      profileManagerAppMenu(ownBundleDisplayName() ?? PROFILE_MANAGER_APP_NAME),
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
  // Electron takes the Keychain item name from this name; the menu labels use the bundle's
  // display name (profileManagerAppMenu).
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
