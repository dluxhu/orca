import { afterEach, describe, expect, it, vi } from 'vitest'

const { setMenu } = vi.hoisted(() => ({ setMenu: vi.fn() }))

vi.mock('electron', () => ({
  app: { name: 'Orca' },
  BrowserWindow: { getFocusedWindow: () => null },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: setMenu },
  MenuItem: class {},
  webContents: { getFocusedWebContents: () => null }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))

import { registerAppMenu } from './register-app-menu'

const handlers = {
  onOpenSettings: vi.fn(),
  onOpenWorktreePalette: vi.fn(),
  onOpenSetupGuide: vi.fn(),
  onOpenFeatureTour: vi.fn(),
  onOpenCrashReport: vi.fn(),
  onCheckForUpdates: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
  onToggleLeftSidebar: vi.fn(),
  onToggleRightSidebar: vi.fn(),
  onToggleAppearance: vi.fn(),
  getAppearanceState: () => ({
    showTasksButton: true,
    showAutomationsButton: true,
    showMobileButton: true,
    showTitlebarAppName: true,
    statusBarVisible: true
  })
}

const labels = (): unknown[] =>
  (setMenu.mock.calls.at(-1)?.[0] as { label?: string }[]).map((menu) => menu.label)

describe('registerAppMenu Profiles menu', () => {
  const platform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform })
  })

  it('puts the Profiles menu between View and Window on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const items = [{ label: 'Profile Manager…' }]
    registerAppMenu({ ...handlers, getProfilesMenuItems: () => items })
    expect(labels()).toEqual(['Orca', 'Edit', 'View', 'Profiles', 'Window', 'Help'])
    const menus = setMenu.mock.calls.at(-1)?.[0] as { label?: string; submenu?: unknown }[]
    expect(menus[3].submenu).toBe(items)
  })

  it('has no Profiles menu without the items or on other platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    registerAppMenu(handlers)
    expect(labels()).not.toContain('Profiles')
    Object.defineProperty(process, 'platform', { value: 'linux' })
    registerAppMenu({ ...handlers, getProfilesMenuItems: () => [] })
    expect(labels()).not.toContain('Profiles')
  })
})
