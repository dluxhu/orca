import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isManager: false,
  hasLock: true,
  ready: Promise.resolve(),
  app: {
    setPath: vi.fn(),
    setName: vi.fn(),
    requestSingleInstanceLock: vi.fn(),
    exit: vi.fn(),
    dock: { hide: vi.fn() },
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn()
  },
  ipcOn: vi.fn(),
  setMenu: vi.fn(),
  registerIpc: vi.fn(),
  startMenu: vi.fn(),
  openWindow: vi.fn(),
  runSmoke: vi.fn(),
  writeSync: vi.fn()
}))

vi.mock('electron', () => ({
  app: h.app,
  ipcMain: { on: h.ipcOn },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: h.setMenu }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('./app-profile', () => ({
  isProfileManagerApp: () => h.isManager,
  ownBundleDisplayName: () => 'Orca @dLux Profile Manager'
}))
vi.mock('./profile-manager', () => ({
  profilesMenuItems: () => [{ label: 'Profile Manager…' }],
  registerProfileManagerIpc: h.registerIpc,
  startProfilesMenu: h.startMenu
}))
vi.mock('node:fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  writeSync: h.writeSync
}))
vi.mock('./profile-manager-smoke', () => ({
  PROFILE_MANAGER_SMOKE_ENV: 'ORCA_PROFILE_MANAGER_SMOKE',
  runProfileManagerSmoke: h.runSmoke
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

/**
 * The source of the Manager renderer entry and every module that it imports: relative paths, the
 * `@/` and `@renderer/` aliases, side-effect imports and dynamic imports.
 */
function managerRendererSource(): { source: string; files: Set<string> } {
  const rendererRoot = join(SRC, 'renderer', 'src')
  const seen = new Set<string>()
  const queue = [join(rendererRoot, 'profile-manager.tsx')]
  let source = ''
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    source += text
    const specs = text.matchAll(/(?:from|import|import\()\s*'((?:\.{1,2}|@|@renderer)\/[^']+)'/g)
    for (const [, spec] of specs) {
      const base = spec.startsWith('@')
        ? join(rendererRoot, spec.replace(/^@(renderer)?\//, ''))
        : resolve(dirname(file), spec)
      const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((ext) => base + ext)
        .find((path) => /\.tsx?$/.test(path) && existsSync(path))
      if (found) {
        queue.push(found)
      }
    }
  }
  return { source, files: seen }
}

afterEach(() => vi.unstubAllEnvs())

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
    const menus = h.setMenu.mock.calls[0][0] as {
      label?: string
      role?: string
      submenu?: { label?: string; role?: string }[]
    }[]
    expect(menus.map((menu) => menu.label ?? menu.role)).toEqual([
      'Orca @dLux Profile Manager',
      'editMenu',
      'Profiles',
      'windowMenu'
    ])
    // The labels take the bundle's display name; the app name (the Keychain item) stays.
    const labels = new Map(menus[0].submenu?.map((item) => [item.role, item.label]))
    expect([labels.get('about'), labels.get('hide'), labels.get('quit')]).toEqual([
      'About Orca @dLux Profile Manager',
      'Hide Orca @dLux Profile Manager',
      'Quit Orca @dLux Profile Manager'
    ])
    expect(h.app.setName).toHaveBeenCalledWith('Orca Profile Manager')
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
    const { source, files } = managerRendererSource()
    // Only `@/components/ui/dialog` imports reach this module, so the walk follows the alias.
    expect(files).toContain(join(SRC, 'renderer', 'src', 'components', 'ui', 'dialog.tsx'))
    const used = [...preloadSyncMethods()]
      .filter(([method]) => source.includes(`.${method}(`))
      .map(([, channel]) => channel)
    // An unanswered sendSync blocks the renderer until the event is collected: about 40 s.
    expect(used).toEqual(
      expect.arrayContaining(['settings:get-sync', 'browser:reserveGuestDiscard'])
    )
    expect(used.filter((channel) => !registered.has(channel))).toEqual([])
    const reply = (channel: string): unknown => {
      const event = { returnValue: undefined as unknown }
      h.ipcOn.mock.calls.find(([name]) => name === channel)?.[1](event)
      return event.returnValue
    }
    expect(reply('settings:get-sync')).toBeNull()
    expect(reply('browser:reserveGuestDiscard')).toBe(false)
  })

  it('in smoke mode, checks a hidden window with no Dock icon and exits with its result', async () => {
    vi.stubEnv('ORCA_PROFILE_MANAGER_SMOKE', '1')
    runProfileManagerApp()
    await h.ready
    await vi.waitFor(() => expect(h.runSmoke).toHaveBeenCalledTimes(1))
    expect(h.app.dock.hide).toHaveBeenCalled()
    expect(h.startMenu).not.toHaveBeenCalled()
    // No window events keep the app or open another window during the check.
    expect(h.app.on).not.toHaveBeenCalled()
    const [open, done] = h.runSmoke.mock.calls[0] as [() => unknown, (l: string, c: number) => void]
    open()
    expect(h.openWindow).toHaveBeenCalledWith({ hidden: true })
    done('profile-manager-smoke: fail x', 1)
    expect(h.writeSync).toHaveBeenCalledWith(1, 'profile-manager-smoke: fail x\n')
    expect(h.app.exit).toHaveBeenCalledWith(1)
  })

  it('in smoke mode, a second instance fails with a result line', () => {
    vi.stubEnv('ORCA_PROFILE_MANAGER_SMOKE', '1')
    h.hasLock = false
    runProfileManagerApp()
    expect(h.writeSync).toHaveBeenCalledWith(1, 'profile-manager-smoke: fail already running\n')
    expect(h.app.exit).toHaveBeenCalledWith(1)
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
