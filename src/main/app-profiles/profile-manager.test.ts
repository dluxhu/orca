import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProfileRow } from '../../shared/app-profiles/app-profile-rules'

const { handlers, rows, isManager, profile, appOn, launchctl } = vi.hoisted(() => ({
  appOn: vi.fn(),
  launchctl: vi.fn(async () => ({ code: 113, out: '' })),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  rows: { current: [] as AppProfileRow[] },
  isManager: { current: true },
  profile: { current: null as { id: string; userDataPath: string } | null }
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/default-data', on: appOn },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: {} }))
vi.mock('./app-profile', () => ({ getAppProfile: () => profile.current }))
vi.mock('./profile-manager-window', () => ({
  isProfileManagerRenderer: () => isManager.current,
  openProfileManagerWindow: vi.fn()
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
  state
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
      'rename',
      'work',
      '--name',
      'Job',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'set-port', id: 'work', port: 7000 })).toEqual([
      'set-port',
      'work',
      '--port',
      '7000',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'remove', id: 'work', keepData: true })).toEqual([
      'remove',
      'work',
      '--keep-data',
      '--json'
    ])
    expect(profileCommandArgs({ kind: 'remove', id: 'work', keepData: false })).toEqual([
      'remove',
      'work',
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
      'appProfiles:open'
    ])
    await expect(handlers.get('appProfiles:state')?.({ sender: {} })).resolves.toMatchObject({
      currentId: 'default'
    })
    isManager.current = false
    for (const channel of handlers.keys()) {
      await expect(handlers.get(channel)?.({ sender: {} }, 'work')).rejects.toThrow(
        'Only the Profile Manager window'
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
      ['Orca — Running', false],
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
      const activate = appOn.mock.calls
        .filter(([event]) => event === 'did-become-active')
        .at(-1)?.[1]
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
