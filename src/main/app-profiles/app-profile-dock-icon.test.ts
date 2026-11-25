import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { largestIcnsPng, writeIcns } from '../../cli/app-profiles/app-profile-icns'

const h = vi.hoisted(() => ({
  userData: '',
  profile: null as { id: string } | null,
  createFromBuffer: vi.fn(),
  createFromPath: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userData : '') },
  nativeImage: { createFromBuffer: h.createFromBuffer, createFromPath: h.createFromPath }
}))
vi.mock('./app-profile', () => ({ getAppProfile: () => h.profile }))

let dir: string
let icns: Buffer

beforeEach(() => {
  vi.resetModules()
  h.createFromBuffer.mockReset().mockImplementation((png: Buffer, options?: unknown) => ({
    png,
    options,
    isEmpty: () => false,
    setTemplateImage: vi.fn()
  }))
  h.createFromPath.mockReset().mockImplementation((path: string) => ({
    path,
    isEmpty: () => !existsSync(path),
    setTemplateImage: vi.fn()
  }))
  dir = mkdtempSync(join(tmpdir(), 'dock-icon-'))
  h.userData = join(dir, 'work')
  mkdirSync(h.userData)
  const img = { width: 16, height: 16, channels: 4, data: new Uint8Array(16 * 16 * 4).fill(200) }
  icns = writeIcns(img as never)
  writeFileSync(join(h.userData, 'profile-icon.icns'), icns)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ownDockIcon', () => {
  it('reads the icon that the profile userData keeps, once', async () => {
    h.profile = { id: 'work' }
    const { ownDockIcon } = await import('./app-profile-dock-icon')
    const image = ownDockIcon()
    expect(ownDockIcon()).toBe(image)
    expect(h.createFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.createFromBuffer.mock.calls[0][0]).toEqual(largestIcnsPng(icns))
  })

  it('reads the kept copy again after forgetOwnDockIcon: a new icon replaces none', async () => {
    h.profile = { id: 'work' }
    rmSync(join(h.userData, 'profile-icon.icns'))
    const { forgetOwnDockIcon, ownDockIcon } = await import('./app-profile-dock-icon')
    expect(ownDockIcon()).toBeNull()
    writeFileSync(join(h.userData, 'profile-icon.icns'), icns)
    expect(ownDockIcon()).toBeNull()
    forgetOwnDockIcon()
    expect(ownDockIcon()).not.toBeNull()
  })

  it('is null in the default app', async () => {
    h.profile = null
    const { ownDockIcon } = await import('./app-profile-dock-icon')
    expect(ownDockIcon()).toBeNull()
    expect(h.createFromBuffer).not.toHaveBeenCalled()
  })
})

describe('ownMenuBarImage', () => {
  it('reads the template that the userData keeps by its @2x name, as a template image', async () => {
    const { ownMenuBarImage } = await import('./app-profile-dock-icon')
    // No kept template, as in the default app: the plain glyph.
    expect(ownMenuBarImage()).toBeNull()
    const path = join(h.userData, 'profile-menu-bar@2x.png')
    writeFileSync(path, 'png')
    const image = ownMenuBarImage() as unknown as {
      path: string
      setTemplateImage: ReturnType<typeof vi.fn>
    }
    expect(image.path).toBe(path)
    expect(image.setTemplateImage).toHaveBeenCalledWith(true)
  })
})
