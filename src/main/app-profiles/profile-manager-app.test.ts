import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  setMenu: vi.fn(),
  registerIpc: vi.fn(),
  startMenu: vi.fn(),
  openWindow: vi.fn()
}))

vi.mock('electron', () => ({
  app: h.app,
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: h.setMenu }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('./app-profile', () => ({ isProfileManagerApp: () => h.isManager }))
vi.mock('./profile-manager', () => ({
  profilesMenuItems: () => [{ label: 'Profile Manager…' }],
  registerProfileManagerIpc: h.registerIpc,
  startProfilesMenu: h.startMenu
}))
vi.mock('./profile-manager-window', () => ({ openProfileManagerWindow: h.openWindow }))

import { runProfileManagerApp } from './profile-manager-app'

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
    expect(h.openWindow).toHaveBeenCalledTimes(1)
    const rebuild = h.startMenu.mock.calls[0][0] as () => void
    rebuild()
    const menus = h.setMenu.mock.calls[0][0] as { label?: string; role?: string }[]
    expect(menus.map((menu) => menu.label ?? menu.role)).toEqual([
      'appMenu',
      'editMenu',
      'Profiles',
      'windowMenu'
    ])
    const on = new Map(h.app.on.mock.calls as [string, () => void][])
    // A second start focuses the window of the first one.
    on.get('second-instance')?.()
    expect(h.openWindow).toHaveBeenCalledTimes(2)
    on.get('window-all-closed')?.()
    expect(h.app.quit).toHaveBeenCalled()
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
