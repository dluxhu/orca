import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const template: Electron.MenuItemConstructorOptions[] = []
  return { setPath: vi.fn(), hasSwitch: vi.fn((_name: string) => false), template }
})

vi.mock('electron', () => ({
  app: {
    name: 'Orca @dLux',
    getPath: vi.fn((name: string) =>
      name === 'userData' ? '/Users/u/Library/Application Support/orca' : '/app-data'
    ),
    setPath: electron.setPath,
    quit: vi.fn(),
    exit: vi.fn(),
    isPackaged: true,
    disableHardwareAcceleration: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
      getSwitchValue: vi.fn(() => ''),
      hasSwitch: electron.hasSwitch
    }
  },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  MenuItem: vi.fn(function MenuItem(options: Electron.MenuItemConstructorOptions) {
    return options
  }),
  Menu: {
    buildFromTemplate: vi.fn((template: Electron.MenuItemConstructorOptions[]) => {
      electron.template = template
      return {}
    }),
    setApplicationMenu: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

// Fork patch tests that need the Electron app. See docs/fork/PATCHES.md.
describe('Orca @dLux fork in the Electron app', () => {
  it('pins the default official `orca` userData folder for a packaged launch', async () => {
    const { configureDevUserDataPath } = await import('./configure-process')
    configureDevUserDataPath(false)
    expect(electron.setPath.mock.calls).toEqual([
      ['userData', '/Users/u/Library/Application Support/orca']
    ])
  })

  it('keeps an explicit --user-data-dir profile and does not pin', async () => {
    const { configureDevUserDataPath } = await import('./configure-process')
    electron.setPath.mockClear()
    electron.hasSwitch.mockImplementationOnce((name) => name === 'user-data-dir')
    configureDevUserDataPath(false)
    expect(electron.setPath).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'darwin')(
    'names the fork in the About, Hide and Quit items',
    async () => {
      const { registerAppMenu } = await import('../menu/register-app-menu')
      const noop = (): void => {}
      registerAppMenu({
        onOpenSettings: noop,
        onOpenSetupGuide: noop,
        onOpenFeatureTour: noop,
        onOpenCrashReport: noop,
        onCheckForUpdates: noop,
        onZoomIn: noop,
        onZoomOut: noop,
        onZoomReset: noop,
        onToggleLeftSidebar: noop,
        onToggleRightSidebar: noop,
        onToggleAppearance: noop,
        onQuit: noop,
        getAppearanceState: () => ({
          showTasksButton: true,
          showAutomationsButton: true,
          showMobileButton: true,
          showTitlebarAppName: true,
          statusBarVisible: true
        })
      })
      const appMenu = electron.template[0]
      const submenu = Array.isArray(appMenu.submenu) ? appMenu.submenu : []
      const labels = submenu.map((item) => item.label)
      expect(appMenu.label).toBe('Orca @dLux')
      expect(labels).toContain('About Orca @dLux')
      expect(labels).toContain('Hide Orca @dLux')
      expect(labels).toContain('Quit Orca @dLux')
    }
  )
})
