// The sender check with the real window module, and the CLI spawn without a shell.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  windows: [] as { webContents: object }[],
  execFileCalls: [] as { file: string; args: string[]; options: Record<string, unknown> }[]
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = { id: Math.random() }
    constructor() {
      h.windows.push(this)
    }
    isDestroyed = () => false
    isMinimized = () => false
    focus = vi.fn()
    once = vi.fn()
    on = vi.fn()
    loadFile = vi.fn(async () => {})
    loadURL = vi.fn(async () => {})
  }
  return {
    app: { isPackaged: true, getPath: () => '/default-data', on: vi.fn() },
    BrowserWindow,
    nativeTheme: { shouldUseDarkColors: false },
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
        h.handlers.set(channel, fn)
    }
  }
})
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: (file: string, args: string[], options: unknown, callback?: unknown) => {
    const done = (typeof options === 'function' ? options : callback) as (
      error: Error | null,
      stdout: string
    ) => void
    h.execFileCalls.push({
      file,
      args,
      options: (typeof options === 'object' ? options : {}) as Record<string, unknown>
    })
    done(null, '{"ok":true,"result":{}}')
  }
}))
vi.mock('../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal', () => ({
  runServeServiceManager: async () => ({ code: 113, out: '' })
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: {} }))
vi.mock('./app-profile', () => ({ getAppProfile: () => null }))
vi.mock('../window/security/privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import { registerProfileManagerIpc } from './profile-manager'
import { openProfileManagerWindow } from './profile-manager-window'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-profile-manager-ipc-'))
  vi.stubEnv('ORCA_PROFILES_ROOT', join(root, 'profiles'))
  vi.stubEnv('HOME', root)
  Object.defineProperty(process, 'resourcesPath', { value: '/app/Resources', configurable: true })
  h.execFileCalls.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('Profile Manager IPC', () => {
  it('answers only the Profile Manager window, before and after it opens', async () => {
    registerProfileManagerIpc()
    const other = { sender: { id: 'main-window' } }
    const change = { kind: 'remove', id: 'work', keepData: false }
    for (const [channel, arg] of [
      ['appProfiles:state', undefined],
      ['appProfiles:change', change],
      ['appProfiles:open', 'work']
    ] as const) {
      await expect(h.handlers.get(channel)?.(other, arg)).rejects.toThrow(
        'Only the Profile Manager window'
      )
    }
    openProfileManagerWindow()
    const manager = { sender: h.windows.at(-1)?.webContents }
    await expect(h.handlers.get('appProfiles:change')?.(other, change)).rejects.toThrow(
      'Only the Profile Manager window'
    )
    expect(h.execFileCalls).toEqual([])
    await h.handlers.get('appProfiles:change')?.(manager, change)
    expect(h.execFileCalls).toHaveLength(1)
  })

  it('runs the CLI as Node with the name as one argument, without a shell', async () => {
    registerProfileManagerIpc()
    openProfileManagerWindow()
    const manager = { sender: h.windows.at(-1)?.webContents }
    const name = 'x"; rm -rf ~ #$(id)`id`'
    await h.handlers.get('appProfiles:change')?.(manager, {
      kind: 'create',
      name,
      id: 'w',
      port: 6800,
      copySettings: false
    })
    const call = h.execFileCalls[0]
    expect(call.file).toBe(process.execPath)
    expect(call.args).toEqual([
      join('/app/Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js'),
      'profiles',
      'create',
      name,
      '--id',
      'w',
      '--port',
      '6800',
      '--pin-root',
      '--json'
    ])
    expect(call.options.shell).toBeUndefined()
    expect((call.options.env as Record<string, string>).ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
