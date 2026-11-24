import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ windows: [] as Record<string, ReturnType<typeof vi.fn>>[] }))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = { send: vi.fn() }
    constructor() {
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
  return { app: { isPackaged: true }, BrowserWindow, nativeTheme: { shouldUseDarkColors: false } }
})
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('../window/security/privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import { openProfileManagerWindow } from './profile-manager-window'

afterEach(() => {
  h.windows.length = 0
})

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
})
