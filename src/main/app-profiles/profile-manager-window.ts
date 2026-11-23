// The Profile Manager window. Each Orca app can show it. See docs/fork/profiles-design.md, section 4.
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { translateMain } from '../i18n/main-i18n'
import { installPrivilegedWindowNavigationPolicy } from '../window/security/privileged-window-navigation'

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
