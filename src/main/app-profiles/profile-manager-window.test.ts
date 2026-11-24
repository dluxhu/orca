import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ windows: [] as Record<string, ReturnType<typeof vi.fn>>[] }))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = { send: vi.fn(), isLoadingMainFrame: vi.fn(() => false) }
    constructor(public options: unknown) {
      h.windows.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
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
    app: { isPackaged: true, getAppPath: () => '/App/app.asar' },
    BrowserWindow,
    nativeTheme: { shouldUseDarkColors: false }
  }
})
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../window/security/privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import { openProfileManagerWindow } from './profile-manager-window'

// The module keeps its one window across the tests of this file.

describe('openProfileManagerWindow', () => {
  it('asks for the New dialog by the URL hash of a new window, and by an event to an open one', () => {
    openProfileManagerWindow({ startNew: true })
    expect(h.windows).toHaveLength(1)
    const [window] = h.windows as unknown as {
      loadFile: ReturnType<typeof vi.fn>
      webContents: { send: ReturnType<typeof vi.fn> }
    }[]
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringMatching(/profile-manager\.html$/), {
      hash: 'new'
    })
    openProfileManagerWindow()
    expect(window.webContents.send).not.toHaveBeenCalled()
    openProfileManagerWindow({ startNew: true })
    expect(h.windows).toHaveLength(1)
    expect(window.webContents.send).toHaveBeenCalledWith('appProfiles:startNew')
  })

  it('loads a window that still loads again with the hash, so New profile… is not lost', () => {
    const window = h.windows[0] as unknown as {
      loadFile: ReturnType<typeof vi.fn>
      webContents: { send: ReturnType<typeof vi.fn>; isLoadingMainFrame: ReturnType<typeof vi.fn> }
    }
    window.loadFile.mockClear()
    window.webContents.send.mockClear()
    window.webContents.isLoadingMainFrame.mockReturnValue(true)
    openProfileManagerWindow({ startNew: true })
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringMatching(/profile-manager\.html$/), {
      hash: 'new'
    })
  })

  it('loads the page and the preload from the app path, also from a bundler chunk', () => {
    // The window of the first test.
    const window = h.windows[0] as unknown as {
      options: { webPreferences: { preload: string } }
      loadFile: ReturnType<typeof vi.fn>
    }
    expect(window.options.webPreferences.preload).toBe('/App/app.asar/out/preload/index.js')
    expect(window.loadFile).toHaveBeenCalledWith(
      '/App/app.asar/out/renderer/profile-manager.html',
      {
        hash: 'new'
      }
    )
  })
})
