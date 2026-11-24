import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as ChildProcess from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isManager: false,
  defaultApp: '',
  opened: [] as string[][],
  // A new window, or a focus of the one window.
  shown: 0,
  windows: [] as {
    loadFile: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn>; isLoadingMainFrame: ReturnType<typeof vi.fn> }
  }[]
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = { send: vi.fn(), isLoadingMainFrame: vi.fn(() => false) }
    constructor() {
      h.shown++
      h.windows.push(this)
    }
    isDestroyed = () => false
    isMinimized = () => false
    focus = () => h.shown++
    once = vi.fn()
    on = vi.fn()
    loadFile = vi.fn(async () => {})
    loadURL = vi.fn(async () => {})
  }
  return { app: { isPackaged: true }, BrowserWindow, nativeTheme: { shouldUseDarkColors: false } }
})
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFile: (file: string, args: string[]) => h.opened.push([file, ...args])
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../window/security/privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))
vi.mock('./app-profile', () => ({
  isProfileManagerApp: () => h.isManager,
  ownDefaultAppPath: async () => h.defaultApp
}))

import { openProfileManagerWindow, showProfileManager } from './profile-manager-window'

let dir: string
const managerApp = (): string =>
  join(h.defaultApp, 'Contents', 'Applications', 'Orca Profile Manager.app')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-manager-window-'))
  h.defaultApp = join(dir, 'Orca.app')
  h.isManager = false
  h.opened.length = 0
  h.shown = 0
  h.windows.length = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// First: the window module keeps its one window for the rest of the file.
describe('New profile…', () => {
  it('starts a new Profile Manager instance with the argument; a running one gets it as second-instance', async () => {
    mkdirSync(managerApp(), { recursive: true })
    await showProfileManager({ startNew: true })
    expect(h.opened).toEqual([
      ['/usr/bin/open', '-n', '-a', managerApp(), '--args', '--new-profile']
    ])
  })

  it('asks for the New dialog by the URL hash of a new window, and by an event to an open one', () => {
    openProfileManagerWindow({ startNew: true })
    expect(h.windows).toHaveLength(1)
    const [window] = h.windows
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringMatching(/profile-manager\.html$/), {
      hash: 'new'
    })
    openProfileManagerWindow()
    expect(window.webContents.send).not.toHaveBeenCalled()
    openProfileManagerWindow({ startNew: true })
    expect(h.windows).toHaveLength(1)
    expect(window.webContents.send).toHaveBeenCalledWith('appProfiles:startNew')
    // A window that still loads has no listener: it loads again with the hash.
    window.loadFile.mockClear()
    window.webContents.send.mockClear()
    window.webContents.isLoadingMainFrame.mockReturnValue(true)
    openProfileManagerWindow({ startNew: true })
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringMatching(/profile-manager\.html$/), {
      hash: 'new'
    })
  })
})

describe('showProfileManager', () => {
  it('opens the Profile Manager app inside the default app, without -n', async () => {
    mkdirSync(managerApp(), { recursive: true })
    await showProfileManager()
    // Without -n, `open` brings a running Profile Manager to the front: one instance.
    expect(h.opened).toEqual([['/usr/bin/open', '-a', managerApp()]])
    expect(h.shown).toBe(0)
  })

  it("shows this app's own window when the build has no Profile Manager app (dev)", async () => {
    await showProfileManager()
    expect(h.opened).toEqual([])
    expect(h.shown).toBe(1)
  })

  it('shows its own window in the Profile Manager app', async () => {
    mkdirSync(managerApp(), { recursive: true })
    h.isManager = true
    await showProfileManager()
    expect(h.opened).toEqual([])
    expect(h.shown).toBe(1)
  })
})
