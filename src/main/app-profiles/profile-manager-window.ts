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

/** The Profile Manager app argument that opens the New dialog. */
export const PROFILE_MANAGER_NEW_ARG = '--new-profile'

/** Shows the one Profile Manager window of this app. `startNew` also opens the New dialog. */
export function openProfileManagerWindow(
  options: { startNew?: boolean; hidden?: boolean } = {}
): BrowserWindow {
  if (profileManagerWindow && !profileManagerWindow.isDestroyed()) {
    if (profileManagerWindow.isMinimized()) {
      profileManagerWindow.restore()
    }
    profileManagerWindow.focus()
    if (options.startNew && profileManagerWindow.webContents.isLoadingMainFrame()) {
      // A page that still loads has no listener yet: load it again with the request in the hash.
      loadPage(profileManagerWindow, 'new')
    } else if (options.startNew) {
      profileManagerWindow.webContents.send('appProfiles:startNew')
    }
    return profileManagerWindow
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
  if (!options.hidden) {
    window.once('ready-to-show', () => window.show())
  }
  window.on('closed', () => {
    if (profileManagerWindow === window) {
      profileManagerWindow = null
    }
  })
  // A new window has no listener yet, so the URL hash asks for the New dialog.
  loadPage(window, options.startNew ? 'new' : '')
  return window
}

function loadPage(window: BrowserWindow, hash: string): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/profile-manager.html#${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/profile-manager.html'), { hash })
  }
}

/** Brings the app to the front, or starts it. `args` start a new instance with them. */
export function openApp(appPath: string, args: string[] = []): void {
  const open = args.length > 0 ? ['-n', '-a', appPath, '--args', ...args] : ['-a', appPath]
  execFile('/usr/bin/open', open, (error) => {
    if (error) {
      console.warn('[profiles] open failed:', error.message)
    }
  })
}

/**
 * Opens the Profile Manager app, which `open` starts once and brings to the front after that.
 * This app's own window serves in the Manager app and where the build has no Manager app (dev).
 */
export async function showProfileManager(options: { startNew?: boolean } = {}): Promise<void> {
  if (isProfileManagerApp()) {
    openProfileManagerWindow(options)
    return
  }
  const managerApp = profileManagerAppPath(await ownDefaultAppPath())
  try {
    await access(managerApp)
  } catch {
    openProfileManagerWindow(options)
    return
  }
  // A running Manager app gets the argument through its single-instance lock (second-instance).
  openApp(managerApp, options.startNew ? [PROFILE_MANAGER_NEW_ARG] : [])
}
