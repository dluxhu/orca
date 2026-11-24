import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isManager: false,
  hasLock: true,
  ready: Promise.resolve(),
  app: {
    setPath: vi.fn(),
    setName: vi.fn(),
    requestSingleInstanceLock: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn()
  },
  ipcOn: vi.fn(),
  setMenu: vi.fn(),
  registerIpc: vi.fn(),
  startMenu: vi.fn(),
  openWindow: vi.fn()
}))

vi.mock('electron', () => ({
  app: h.app,
  ipcMain: { on: h.ipcOn },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: h.setMenu }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('./app-profile', () => ({ isProfileManagerApp: () => h.isManager }))
vi.mock('./profile-manager', () => ({
  profilesMenuItems: () => [{ label: 'Profile Manager…' }],
  registerProfileManagerIpc: h.registerIpc,
  startProfilesMenu: h.startMenu
}))
vi.mock('./profile-manager-window', () => ({
  openProfileManagerWindow: h.openWindow,
  PROFILE_MANAGER_NEW_ARG: '--new-profile'
}))

import { runProfileManagerApp } from './profile-manager-app'

const SRC = join(import.meta.dirname, '..', '..')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** Preload method name to its sendSync channel (a literal, or the constant's name). */
function preloadSyncMethods(): Map<string, string> {
  const methods = new Map<string, string>()
  for (const file of filesUnder(join(SRC, 'preload', 'api'))) {
    const text = readFileSync(file, 'utf8')
    for (const call of text.matchAll(/sendSync\(\s*'?([\w:-]+)/g)) {
      const before = text.slice(Math.max(0, call.index - 400), call.index)
      const method = [...before.matchAll(/(\w+):\s*\(/g)].at(-1)?.[1]
      if (method) {
        methods.set(method, call[1])
      }
    }
  }
  return methods
}

/** The source of the Manager renderer entry and every module that it imports by a relative path. */
function managerRendererSource(): string {
  const seen = new Set<string>()
  const queue = [join(SRC, 'renderer', 'src', 'profile-manager.tsx')]
  let source = ''
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    source += text
    for (const [, spec] of text.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      const base = resolve(dirname(file), spec)
      const found = ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((ext) => base + ext)
        .find((path) => existsSync(path))
      if (found) {
        queue.push(found)
      }
    }
  }
  return source
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ORCA_PROFILES_ROOT', '/profiles')
  h.isManager = true
  h.app.requestSingleInstanceLock.mockImplementation(() => h.hasLock)
  h.hasLock = true
  h.app.whenReady.mockImplementation(() => h.ready)
})

describe('runProfileManagerApp', () => {
  it('does nothing in the default app and in profile apps', () => {
    h.isManager = false
    expect(runProfileManagerApp()).toBe(false)
    expect(h.app.setPath).not.toHaveBeenCalled()
    expect(h.app.requestSingleInstanceLock).not.toHaveBeenCalled()
  })

  it('shows only the Profile Manager window, with its own userData and the Profiles menu', async () => {
    expect(runProfileManagerApp()).toBe(true)
    expect(h.app.setPath).toHaveBeenCalledWith('userData', join('/profiles', '.manager'))
    expect(h.registerIpc).toHaveBeenCalledTimes(1)
    await h.ready
    await Promise.resolve()
    expect(h.openWindow).toHaveBeenCalledWith({ startNew: false })
    const rebuild = h.startMenu.mock.calls[0][0] as () => void
    rebuild()
    const menus = h.setMenu.mock.calls[0][0] as { label?: string; role?: string }[]
    expect(menus.map((menu) => menu.label ?? menu.role)).toEqual([
      'appMenu',
      'editMenu',
      'Profiles',
      'windowMenu'
    ])
    const on = new Map(h.app.on.mock.calls as [string, (...args: unknown[]) => void][])
    // A second start focuses the window of the first one, and passes on "New profile…".
    on.get('second-instance')?.({}, ['/x/Orca Profile Manager', '--new-profile'])
    expect(h.openWindow).toHaveBeenLastCalledWith({ startNew: true })
    on.get('second-instance')?.({}, ['/x/Orca Profile Manager'])
    expect(h.openWindow).toHaveBeenLastCalledWith({ startNew: false })
    on.get('window-all-closed')?.()
    expect(h.app.quit).toHaveBeenCalled()
  })

  it('answers every sync channel that the Manager renderer can call', () => {
    expect(runProfileManagerApp()).toBe(true)
    const registered = new Set(h.ipcOn.mock.calls.map(([channel]) => channel as string))
    const source = managerRendererSource()
    const used = [...preloadSyncMethods()]
      .filter(([method]) => source.includes(`.${method}(`))
      .map(([, channel]) => channel)
    // An unanswered sendSync blocks the renderer until the event is collected: about 40 s.
    expect(used).toContain('settings:get-sync')
    expect(used.filter((channel) => !registered.has(channel))).toEqual([])
    const reply = h.ipcOn.mock.calls.find(([channel]) => channel === 'settings:get-sync')?.[1]
    const event = { returnValue: undefined as unknown }
    reply?.(event)
    expect(event.returnValue).toBeNull()
  })

  it('exits when another Profile Manager runs', () => {
    h.hasLock = false
    expect(runProfileManagerApp()).toBe(true)
    expect(h.app.exit).toHaveBeenCalledWith(0)
    expect(h.registerIpc).not.toHaveBeenCalled()
    expect(h.app.whenReady).not.toHaveBeenCalled()
  })

  it('runs before the app preflight, so the main window and the profile lock never start', () => {
    const entry = readFileSync(join(import.meta.dirname, '..', 'index.ts'), 'utf8')
    expect(entry).toMatch(
      /const preflightReady =\s*!runProfileManagerApp\(\) &&\s*!runWslHolderUninstallPreflight\(\)/
    )
  })
})
