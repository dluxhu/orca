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
  shown: 0
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {}
    constructor() {
      h.shown++
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

import { showProfileManager } from './profile-manager-window'

let dir: string
const managerApp = (): string =>
  join(h.defaultApp, 'Contents', 'Applications', 'Orca Profile Manager.app')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-manager-window-'))
  h.defaultApp = join(dir, 'Orca.app')
  h.isManager = false
  h.opened.length = 0
  h.shown = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
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
