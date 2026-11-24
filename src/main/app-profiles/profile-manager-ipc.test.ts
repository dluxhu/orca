// The sender check with the real window module, and the CLI spawn without a shell.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as ChildProcess from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  windows: [] as { webContents: object }[],
  execFileCalls: [] as { file: string; args: string[]; options: Record<string, unknown> }[],
  stdout: '{"ok":true,"result":{}}',
  dialogArgs: [] as unknown[][],
  profile: null as null | { id: string; userDataPath: string }
}))

vi.mock('electron', () => {
  class BrowserWindow {
    static fromWebContents = (webContents: unknown) =>
      h.windows.find((window) => window.webContents === webContents) ?? null
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
    shell: { showItemInFolder: vi.fn() },
    dialog: {
      showOpenDialog: async (...args: unknown[]) => {
        h.dialogArgs.push(args)
        return { canceled: false, filePaths: ['/x/logo.svg'] }
      }
    },
    nativeTheme: { shouldUseDarkColors: false },
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
        h.handlers.set(channel, fn)
    }
  }
})
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
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
    done(null, h.stdout)
  }
}))
vi.mock('../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal', () => ({
  runServeServiceManager: async () => ({ code: 113, out: '' })
}))
vi.mock('../ipc/ui', () => ({
  isTrustedUIRenderer: (sender: { trusted?: boolean }) => sender.trusted === true
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: {} }))
vi.mock('./app-profile', () => ({
  getAppProfile: () => h.profile,
  isProfileManagerApp: () => false,
  ownDefaultAppPath: async () => '/apps/Orca.app'
}))
vi.mock('../window/security/privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import { mkdirSync, writeFileSync } from 'node:fs'
import { registerProfileManagerIpc } from './profile-manager'
import { openProfileManagerWindow } from './profile-manager-window'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-profile-manager-ipc-'))
  vi.stubEnv('ORCA_PROFILES_ROOT', join(root, 'profiles'))
  vi.stubEnv('HOME', root)
  Object.defineProperty(process, 'resourcesPath', { value: '/app/Resources', configurable: true })
  h.execFileCalls.length = 0
  h.stdout = '{"ok":true,"result":{}}'
  h.profile = null
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
      ['appProfiles:open', 'work'],
      ['appProfiles:iconPreview', { kind: 'badge' }],
      ['appProfiles:chooseIconFile', 'image']
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

  it('shows the icon file dialog on the Profile Manager window', async () => {
    registerProfileManagerIpc()
    openProfileManagerWindow()
    const window = h.windows.at(-1)
    const path = await h.handlers.get('appProfiles:chooseIconFile')?.(
      { sender: window?.webContents },
      'image'
    )
    expect(path).toBe('/x/logo.svg')
    expect(h.dialogArgs.at(-1)?.[0]).toBe(window)
  })

  it('makes the icon preview in the CLI, not in the window', async () => {
    registerProfileManagerIpc()
    openProfileManagerWindow()
    const manager = { sender: h.windows.at(-1)?.webContents }
    h.stdout = '{"ok":true,"result":{"png":"UE5H"}}'
    const reply = await h.handlers.get('appProfiles:iconPreview')?.(
      manager,
      { kind: 'image', path: '/logo.svg', style: 'ref-match' },
      'work'
    )
    expect(reply).toEqual({ ok: true, result: { png: 'UE5H' } })
    expect(h.execFileCalls[0].args.slice(1)).toEqual([
      'profiles',
      'icon-preview',
      '--id',
      'work',
      '--icon-image',
      '/logo.svg',
      '--icon-style',
      'ref-match',
      '--json'
    ])
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

  function writeRegistry(): void {
    const profiles = join(root, 'profiles')
    mkdirSync(join(profiles, 'work'), { recursive: true })
    writeFileSync(
      join(profiles, 'profiles.json'),
      JSON.stringify({
        version: 1,
        defaultAppPath: '/Apps/Orca.app',
        urlHandler: { mode: 'ask' },
        profiles: [
          {
            id: 'work',
            name: 'Orca - Work',
            bundleId: 'b.work',
            appPath: '/Apps/Profiles/Orca - Work.app',
            userDataPath: join(profiles, 'work'),
            port: 6832,
            createdAt: 1
          },
          {
            id: 'home',
            name: 'Orca - Home',
            bundleId: 'b.home',
            appPath: '/Apps/Profiles/Orca - Home.app',
            userDataPath: join(profiles, 'home'),
            port: 6864,
            createdAt: 2
          }
        ]
      })
    )
  }
  const launcher = '/Apps/Orca.app/Contents/Resources/bin/orca'

  it("Start at login installs the chosen profile's service on its port", async () => {
    writeRegistry()
    registerProfileManagerIpc()
    openProfileManagerWindow()
    const manager = { sender: h.windows.at(-1)?.webContents }
    await h.handlers.get('appProfiles:change')?.(manager, {
      kind: 'start-at-login',
      id: 'work',
      enabled: true
    })
    expect(h.execFileCalls[0].args.slice(1)).toEqual([
      '--profile',
      'work',
      'serve',
      'service',
      'install',
      '--port',
      '6832',
      '--command',
      launcher,
      '--json'
    ])
  })

  it("Settings changes only this app's own profile, and shows a failure", async () => {
    writeRegistry()
    registerProfileManagerIpc()
    const settings = { sender: { trusted: true } }
    await expect(
      h.handlers.get('appProfiles:setOwnStartAtLogin')?.({ sender: {} }, true)
    ).rejects.toThrow('Only an Orca window')
    h.stdout = '{"ok":false,"error":{"message":"launchctl bootstrap failed"}}'
    await expect(
      h.handlers.get('appProfiles:setOwnStartAtLogin')?.(settings, true)
    ).resolves.toEqual({
      ok: false,
      error: { message: 'launchctl bootstrap failed' }
    })
    expect(h.execFileCalls[0].args.slice(1, 6)).toEqual([
      '--profile',
      'default',
      'serve',
      'service',
      'install'
    ])
    expect(h.execFileCalls[0].args).toContain('6768')
    await expect(h.handlers.get('appProfiles:ownStartAtLogin')?.(settings)).resolves.toEqual({
      id: 'default',
      enabled: false
    })
  })

  it("Settings in a profile app changes that profile's own service", async () => {
    writeRegistry()
    h.profile = { id: 'home', userDataPath: join(root, 'profiles', 'home') }
    registerProfileManagerIpc()
    await h.handlers.get('appProfiles:setOwnStartAtLogin')?.({ sender: { trusted: true } }, true)
    expect(h.execFileCalls[0].args.slice(1)).toEqual([
      '--profile',
      'home',
      'serve',
      'service',
      'install',
      '--port',
      '6864',
      '--command',
      launcher,
      '--json'
    ])
  })

  it('runs no CLI for an unknown id', async () => {
    writeRegistry()
    registerProfileManagerIpc()
    openProfileManagerWindow()
    const manager = { sender: h.windows.at(-1)?.webContents }
    await expect(
      h.handlers.get('appProfiles:change')?.(manager, {
        kind: 'start-at-login',
        id: 'nobody',
        enabled: true
      })
    ).resolves.toMatchObject({ ok: false })
    expect(h.execFileCalls).toEqual([])
  })
})
