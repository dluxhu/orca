import { EventEmitter } from 'node:events'
import type * as Fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProfileRow } from '../../shared/app-profiles/app-profile-rules'

const { handlers, rows, isManager, profile, appOn, launchctl, reveal, openWindow } = vi.hoisted(
  () => ({
    openWindow: vi.fn(),
    reveal: vi.fn(),
    appOn: vi.fn(),
    launchctl: vi.fn(async (_program: string, _args: string[]) => ({ code: 113, out: '' })),
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    rows: { current: [] as AppProfileRow[] },
    isManager: { current: true },
    profile: { current: null as { id: string; userDataPath: string } | null }
  })
)

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof Fs>()
  return { ...actual, watch: vi.fn(actual.watch) }
})
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/default-data', on: appOn },
  shell: { showItemInFolder: reveal },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: {} }))
vi.mock('./app-profile', () => ({ getAppProfile: () => profile.current }))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => false }))
vi.mock('./profile-manager-window', () => ({
  isProfileManagerRenderer: () => isManager.current,
  openApp: vi.fn(),
  openProfileManagerWindow: openWindow
}))
vi.mock('../../cli/app-profiles/app-profile-list', () => ({
  // One service read and one Dock state read per list, as the real list does for a server.
  listAppProfiles: async (options: {
    serviceRun?: (program: string, args: string[]) => Promise<unknown>
  }) => {
    const run = options.serviceRun ?? launchctl
    await run('launchctl', ['print', 'gui/501/x'])
    await run('/usr/bin/lsappinfo', ['info', '-only', 'ApplicationType', '10'])
    return rows.current
  }
}))
vi.mock('../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal', () => ({
  runServeServiceManager: launchctl
}))

import {
  profileCommandArgs,
  serviceCommandArgs,
  profilesMenuItems,
  readAppProfilesState,
  registerProfileManagerIpc,
  startProfilesMenu
} from './profile-manager'

const row = (id: string, name: string, state: AppProfileRow['state']): AppProfileRow => ({
  id,
  name,
  appPath: `/apps/${name}.app`,
  userDataPath: `/data/${id}`,
  port: 6800,
  state,
  startAtLogin: false
})

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-profile-manager-'))
  vi.stubEnv('ORCA_PROFILES_ROOT', root)
  rows.current = [row('default', 'Orca', 'running')]
  isManager.current = true
  profile.current = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('profileCommandArgs', () => {
  it('builds the orca profiles arguments of each change', () => {
    expect(
      profileCommandArgs(
        { kind: 'create', name: 'Orca - Work', id: 'work', port: 6800, copySettings: true },
        { settingsFile: '/tmp/s.json', pinRoot: true }
      )
    ).toEqual([
      'profiles',
      'create',
      'Orca - Work',
      '--id',
      'work',
      '--port',
      '6800',
      '--settings-file',
      '/tmp/s.json',
      '--pin-root',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'rename', id: 'work', name: 'Job' })).toEqual([
      'profiles',
      'rename',
      'work',
      '--name',
      'Job',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'set-port', id: 'work', port: 7000 })).toEqual([
      'profiles',
      'set-port',
      'work',
      '--port',
      '7000',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'remove', id: 'work', keepData: true })).toEqual([
      'profiles',
      'remove',
      'work',
      '--keep-data',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'remove', id: 'work', keepData: false })).toEqual([
      'profiles',
      'remove',
      'work',
      '--json'
    ])
  })
})

describe('profileCommandArgs for Start at login', () => {
  it("installs and removes that profile's own serve service, on its port", () => {
    const service = { port: 6832, command: '/Apps/Orca.app/Contents/Resources/bin/orca' }
    expect(
      profileCommandArgs({ kind: 'start-at-login', id: 'work', enabled: true }, { service })
    ).toEqual([
      '--profile',
      'work',
      'serve',
      'service',
      'install',
      '--port',
      '6832',
      '--command',
      '/Apps/Orca.app/Contents/Resources/bin/orca',
      '--no-start',
      '--json'
    ])
    // Only the login item goes; a running server keeps running, and the data stays.
    expect(profileCommandArgs({ kind: 'start-at-login', id: 'work', enabled: false })).toEqual([
      '--profile',
      'work',
      'serve',
      'service',
      'uninstall',
      '--keep-running',
      '--json'
    ])
  })
})

describe('serviceCommandArgs', () => {
  const service = { port: 6832, command: '/Apps/Orca.app/Contents/Resources/bin/orca' }
  const install = [
    '--profile',
    'work',
    'serve',
    'service',
    'install',
    '--port',
    '6832',
    '--command',
    service.command,
    '--json'
  ]
  const uninstall = ['--profile', 'work', 'serve', 'service', 'uninstall', '--json']

  it('starts and stops the service and keeps the Start at login choice', () => {
    expect(serviceCommandArgs('work', true, true, service)).toEqual([install])
    expect(serviceCommandArgs('work', true, false, service)).toEqual([
      install,
      [...uninstall.slice(0, -1), '--keep-running', '--json']
    ])
    expect(serviceCommandArgs('work', false, false, service)).toEqual([uninstall])
    expect(serviceCommandArgs('work', false, true, service)).toEqual([
      uninstall,
      [...install.slice(0, -1), '--no-start', '--json']
    ])
  })
})

describe('readAppProfilesState', () => {
  it('reports the data folders that no profile uses as kept ids', async () => {
    rows.current = [row('default', 'Orca', 'running'), row('work', 'Orca - Work', 'stopped')]
    for (const [folder, marker] of [
      ['work', 'work'],
      ['client', 'client'],
      ['stray', 'other'],
      // Ids ignore case: the folder of "home" can be "Home".
      ['Home', 'home']
    ]) {
      mkdirSync(join(root, folder))
      writeFileSync(join(root, folder, 'orca-app-profile.json'), JSON.stringify({ id: marker }))
    }
    mkdirSync(join(root, 'no-marker'))
    const state = await readAppProfilesState()
    expect(state.currentId).toBe('default')
    expect([...state.keptIds].sort()).toEqual(['client', 'home'])
  })
})

describe('registerProfileManagerIpc', () => {
  it('answers only the Profile Manager window', async () => {
    registerProfileManagerIpc()
    expect([...handlers.keys()]).toEqual([
      'appProfiles:state',
      'appProfiles:change',
      'appProfiles:open',
      'appProfiles:showInFinder',
      'appProfiles:ownProfile',
      'appProfiles:setOwnStartAtLogin',
      'appProfiles:setOwnPort'
    ])
    await expect(handlers.get('appProfiles:state')?.({ sender: {} })).resolves.toMatchObject({
      currentId: 'default'
    })
    isManager.current = false
    for (const channel of [
      'appProfiles:state',
      'appProfiles:change',
      'appProfiles:open',
      'appProfiles:showInFinder'
    ]) {
      await expect(handlers.get(channel)?.({ sender: {} }, 'work')).rejects.toThrow(
        'Only the Profile Manager window'
      )
    }
    // Settings of this app: the main window or the Profile Manager window.
    for (const channel of [
      'appProfiles:ownProfile',
      'appProfiles:setOwnStartAtLogin',
      'appProfiles:setOwnPort'
    ]) {
      await expect(handlers.get(channel)?.({ sender: {} }, true)).rejects.toThrow(
        'Only an Orca window'
      )
    }
  })

  it('Show in Finder shows the app of the id, and nothing for an unknown id', async () => {
    rows.current = [row('default', 'Orca', 'running'), row('work', 'Orca - Work', 'stopped')]
    reveal.mockClear()
    registerProfileManagerIpc()
    const show = handlers.get('appProfiles:showInFinder')
    await expect(show?.({ sender: {} }, 'work')).resolves.toMatchObject({ ok: true })
    expect(reveal).toHaveBeenCalledWith('/apps/Orca - Work.app')
    await expect(show?.({ sender: {} }, 'nope')).resolves.toMatchObject({ ok: false })
    expect(reveal).toHaveBeenCalledTimes(1)
  })
})

describe('profilesMenuItems', () => {
  it('lists each app with its state, a check on this app, and the Profile Manager', async () => {
    profile.current = { id: 'work', userDataPath: join(root, 'work') }
    rows.current = [
      row('default', 'Orca', 'running'),
      row('work', 'Orca - Work', 'running'),
      row('home', 'Orca - Home', 'background'),
      row('client', 'Orca - Client', 'stopped')
    ]
    const rebuild = vi.fn()
    startProfilesMenu(rebuild)
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalled())
    const items = profilesMenuItems()
    expect(items.map((item) => [item.type, item.label, item.checked])).toEqual([
      ['header', 'This app', undefined],
      ['checkbox', 'Orca - Work', true],
      ['separator', undefined, undefined],
      ['header', 'Switch to', undefined],
      [undefined, 'Default — Running', undefined],
      [undefined, 'Orca - Home — Running in background', undefined],
      [undefined, 'Orca - Client', undefined],
      ['separator', undefined, undefined],
      [undefined, 'New profile…', undefined],
      [undefined, 'Profile Manager…', undefined]
    ])
  })

  it('New profile… opens the window with the New dialog; Profile Manager… has Shift+Cmd+P', () => {
    const items = profilesMenuItems()
    const item = (label: string) => {
      const found = items.find((candidate) => candidate.label === label)
      if (!found) {
        throw new Error(`No menu item ${label}`)
      }
      return found
    }
    openWindow.mockClear()
    ;(item('New profile…').click as () => void)()
    expect(openWindow).toHaveBeenCalledWith({ startNew: true })
    ;(item('Profile Manager…').click as () => void)()
    expect(openWindow).toHaveBeenLastCalledWith()
    expect(item('Profile Manager…').accelerator).toBe('CommandOrControl+Shift+P')
  })

  it('the main app shows the keybinding as a hint, with no native accelerator', () => {
    const items = profilesMenuItems('⌘⇧P')
    const manager = items.find((item) => item.label?.startsWith('Profile Manager…'))
    expect(manager?.label).toBe('Profile Manager…\t⌘⇧P')
    expect(manager?.accelerator).toBeUndefined()
    // An unbound action: no hint, and still no accelerator.
    const unbound = profilesMenuItems('').find((item) => item.label === 'Profile Manager…')
    expect(unbound?.accelerator).toBeUndefined()
  })
})

describe('Profiles menu refresh on activation', () => {
  it('reads the service states again only after a minute; the Dock state at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const rebuild = vi.fn()
      startProfilesMenu(rebuild)
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1))
      launchctl.mockClear()
      const activate = appOn.mock.calls.findLast(([event]) => event === 'did-become-active')?.[1]
      activate()
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(2))
      // A Dock click can open a server's window at any time: lsappinfo is never cached.
      expect(launchctl.mock.calls.map(([program]) => program)).toEqual(['/usr/bin/lsappinfo'])
      launchctl.mockClear()
      vi.setSystemTime(Date.now() + 61_000)
      activate()
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(3))
      expect(launchctl.mock.calls.map(([program]) => program)).toEqual([
        'launchctl',
        '/usr/bin/lsappinfo'
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Profiles folder watch', () => {
  it('logs a watch error and does not throw', async () => {
    const watcher = Object.assign(new EventEmitter(), { unref: vi.fn(), close: vi.fn() })
    vi.mocked(watch).mockReturnValueOnce(watcher as unknown as ReturnType<typeof watch>)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rebuild = vi.fn()
    startProfilesMenu(rebuild)
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalled())
    expect(() => watcher.emit('error', new Error('folder removed'))).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      '[profiles] the profiles folder watch stopped:',
      expect.any(Error)
    )
    warn.mockRestore()
  })
})
