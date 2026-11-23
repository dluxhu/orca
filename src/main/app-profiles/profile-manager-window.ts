// The Profile Manager: the nested Profile Manager app, and the window that each Orca app can show.
// See docs/fork/profiles-design.md, section 4.
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { translateMain } from '../i18n/main-i18n'
import { installPrivilegedWindowNavigationPolicy } from '../window/security/privileged-window-navigation'
import { profileManagerAppPath } from '../../shared/app-profiles/app-profile-paths'
import { isProfileManagerApp, ownDefaultAppPath } from './app-profile'

let profileManagerWindow: BrowserWindow | null = null

export function isProfileManagerRenderer(sender: WebContents): boolean {
  return (
    profileManagerWindow !== null &&
    !profileManagerWindow.isDestroyed() &&
    profileManagerWindow.webContents === sender
  )
}

/** Shows the one Profile Manager window of this app. */
export function openProfileManagerWindow(): void {
  if (profileManagerWindow && !profileManagerWindow.isDestroyed()) {
    if (profileManagerWindow.isMinimized()) {
      profileManagerWindow.restore()
    }
    profileManagerWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 560,
    minHeight: 420,
    title: translateMain('profileManager.title', 'Orca Profile Manager'),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  profileManagerWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (profileManagerWindow === window) {
      profileManagerWindow = null
    }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/profile-manager.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/profile-manager.html'))
  }
}

/** Brings the app to the front, or starts it. */
export function openApp(appPath: string): void {
  execFile('/usr/bin/open', ['-a', appPath], (error) => {
    if (error) {
      console.warn('[profiles] open failed:', error.message)
    }
  })
}

/**
 * Opens the Profile Manager app, which `open` starts once and brings to the front after that.
 * This app's own window serves in the Manager app and where the build has no Manager app (dev).
 */
export async function showProfileManager(): Promise<void> {
  if (isProfileManagerApp()) {
    openProfileManagerWindow()
    return
  }
  const managerApp = profileManagerAppPath(await ownDefaultAppPath())
  try {
    await access(managerApp)
  } catch {
    openProfileManagerWindow()
    return
  }
  openApp(managerApp)
}
