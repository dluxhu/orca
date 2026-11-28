import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  decode: vi.fn(),
  shape: vi.fn(),
  dialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: h.dialog },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../i18n/main-i18n', () => ({ translateMain: (_key: string, text: string) => text }))
vi.mock('./profile-manager-cli', () => ({ runCli: vi.fn() }))
vi.mock('../window/desktop-integration/custom-app-icon', () => {
  class CustomAppIconImportError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    CUSTOM_APP_ICON_FILE_EXTENSIONS: ['png', 'jpg', 'jpeg'],
    CustomAppIconImportError,
    decodeCustomAppIcon: h.decode
  }
})
vi.mock('../window/desktop-integration/platform-app-icon-shape', () => ({
  fitAppIconToPlatformShape: h.shape
}))

import { CustomAppIconImportError } from '../window/desktop-integration/custom-app-icon'
import { chooseAppProfileIconFile, importIconBase } from './profile-manager-icon'

beforeEach(() => {
  h.decode.mockReset().mockResolvedValue({ raw: true })
  h.shape.mockReset().mockReturnValue({ toPNG: () => Buffer.from('shaped') })
  h.dialog.mockReset().mockResolvedValue({ canceled: false, filePaths: ['/Users/me/Logo.jpeg'] })
})

describe('importIconBase', () => {
  it("writes the upload in the macOS tile shape, after upstream's checks", async () => {
    const path = await importIconBase('/Users/me/Logo.jpeg')
    expect(h.decode).toHaveBeenCalledWith('/Users/me/Logo.jpeg')
    expect(h.shape).toHaveBeenCalledWith({ raw: true })
    expect(typeof path === 'string' && basename(path)).toBe('Logo.png')
    expect(await readFile(path as string, 'utf8')).toBe('shaped')
  })

  it('returns the code of a refused upload', async () => {
    h.decode.mockRejectedValue(new CustomAppIconImportError('notSquare'))
    expect(await importIconBase('/x.png')).toEqual({ code: 'notSquare' })
    h.decode.mockRejectedValue(new Error('disk'))
    await expect(importIconBase('/x.png')).rejects.toThrow('disk')
  })
})

describe('chooseAppProfileIconFile', () => {
  it('imports an uploaded base, and not a badge image', async () => {
    const sender = {} as Electron.WebContents
    expect(await chooseAppProfileIconFile('image', sender)).toBe('/Users/me/Logo.jpeg')
    expect(h.decode).not.toHaveBeenCalled()
    expect(basename((await chooseAppProfileIconFile('file', sender)) as string)).toBe('Logo.png')
    expect(h.dialog.mock.calls[1][0].filters[0].extensions).toEqual(['png', 'jpg', 'jpeg'])
    h.dialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await chooseAppProfileIconFile('file', sender)).toBeNull()
  })
})
