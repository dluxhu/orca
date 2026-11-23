import { EventEmitter } from 'node:events'
import type * as Fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProfileRow } from '../../shared/app-profiles/app-profile-rules'

const { handlers, rows, isManager, profile, appOn, launchctl, managerApp, showManager } =
  vi.hoisted(() => ({
    managerApp: { current: false },
    showManager: vi.fn(async () => {}),
    appOn: vi.fn(),
    launchctl: vi.fn(async () => ({ code: 113, out: '' })),
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    rows: { current: [] as AppProfileRow[] },
    isManager: { current: true },
    profile: { current: null as { id: string; userDataPath: string } | null }
  }))

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof Fs>()
  return { ...actual, watch: vi.fn(actual.watch) }
})
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/default-data', on: appOn },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: {} }))
vi.mock('./app-profile', () => ({
  getAppProfile: () => profile.current,
  isProfileManagerApp: () => managerApp.current,
  ownDefaultAppPath: async () => '/apps/Orca.app'
}))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => false }))
vi.mock('./profile-manager-window', () => ({
  isProfileManagerRenderer: () => isManager.current,
  openApp: vi.fn(),
  showProfileManager: showManager
}))
vi.mock('../../cli/app-profiles/app-profile-list', () => ({
  // One service read per list, as the real list does for each profile.
  listAppProfiles: async (options: {
    serviceRun?: (program: string, args: string[]) => Promise<unknown>
  }) => {
    await (options.serviceRun ?? launchctl)('launchctl', ['print', 'gui/501/x'])
    return rows.current
  }
}))
vi.mock('../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal', () => ({
  runServeServiceManager: launchctl
}))

import {
  profileCommandArgs,
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
  managerApp.current = false
  showManager.mockClear()
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
      '--json'
    ])
    // Uninstall removes only the service; the data stays.
    expect(profileCommandArgs({ kind: 'start-at-login', id: 'work', enabled: false })).toEqual([
      '--profile',
      'work',
      'serve',
      'service',
      'uninstall',
      '--json'
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
      'appProfiles:ownStartAtLogin',
      'appProfiles:setOwnStartAtLogin'
    ])
    await expect(handlers.get('appProfiles:state')?.({ sender: {} })).resolves.toMatchObject({
      currentId: 'default'
    })
    isManager.current = false
    for (const channel of ['appProfiles:state', 'appProfiles:change', 'appProfiles:open']) {
      await expect(handlers.get(channel)?.({ sender: {} }, 'work')).rejects.toThrow(
        'Only the Profile Manager window'
      )
    }
    // Settings of this app: the main window or the Profile Manager window.
    for (const channel of ['appProfiles:ownStartAtLogin', 'appProfiles:setOwnStartAtLogin']) {
      await expect(handlers.get(channel)?.({ sender: {} }, true)).rejects.toThrow(
        'Only an Orca window'
      )
    }
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
    expect(items.map((item) => [item.label, item.checked])).toEqual([
      ['Default — Running', false],
      ['Orca - Work — Running', true],
      ['Orca - Home — Running in background', false],
      ['Orca - Client', false],
      [undefined, undefined],
      ['Profile Manager…', undefined]
    ])
  })
})

describe('Profiles menu refresh on activation', () => {
  it('reads the service states again only after a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const rebuild = vi.fn()
      startProfilesMenu(rebuild)
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1))
      launchctl.mockClear()
      const activate = appOn.mock.calls.findLast(([event]) => event === 'did-become-active')?.[1]
      activate()
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(2))
      expect(launchctl).not.toHaveBeenCalled()
      vi.setSystemTime(Date.now() + 61_000)
      activate()
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(3))
      expect(launchctl).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Profiles > Profile Manager…', () => {
  it('shows the Profile Manager', () => {
    const item = profilesMenuItems().at(-1)
    expect(item?.label).toBe('Profile Manager…')
    const click = item?.click as () => void
    click()
    expect(showManager).toHaveBeenCalledTimes(1)
  })

  it('checks no row in the Profile Manager app, which is no row', async () => {
    managerApp.current = true
    rows.current = [row('default', 'Orca', 'running'), row('work', 'Orca - Work', 'stopped')]
    const rebuild = vi.fn()
    startProfilesMenu(rebuild)
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalled())
    expect(profilesMenuItems().map((item) => item.checked)).toEqual([
      false,
      false,
      undefined,
      undefined
    ])
    expect((await readAppProfilesState()).currentId).toBeNull()
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
