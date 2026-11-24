import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { largestIcnsPng, writeIcns } from '../../cli/app-profiles/app-profile-icns'

const h = vi.hoisted(() => ({
  exe: '',
  profile: null as { id: string } | null,
  createFromBuffer: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.exe },
  nativeImage: { createFromBuffer: h.createFromBuffer }
}))
vi.mock('./app-profile', () => ({ getAppProfile: () => h.profile }))

let dir: string
let icns: Buffer

beforeEach(() => {
  vi.resetModules()
  h.createFromBuffer
    .mockReset()
    .mockImplementation((png: Buffer) => ({ png, isEmpty: () => false }))
  dir = mkdtempSync(join(tmpdir(), 'dock-icon-'))
  const contents = join(dir, 'Work.app', 'Contents')
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  mkdirSync(join(contents, 'Resources'))
  h.exe = join(contents, 'MacOS', 'Orca')
  writeFileSync(
    join(contents, 'Info.plist'),
    '<plist><dict><key>CFBundleIconFile</key><string>icon-0a1b2c3d.icns</string></dict></plist>'
  )
  const img = { width: 16, height: 16, channels: 4, data: new Uint8Array(16 * 16 * 4).fill(200) }
  icns = writeIcns(img as never)
  writeFileSync(join(contents, 'Resources', 'icon-0a1b2c3d.icns'), icns)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ownDockIcon', () => {
  it('reads the icon file that the profile bundle names, once', async () => {
    h.profile = { id: 'work' }
    const { ownDockIcon } = await import('./app-profile-dock-icon')
    const image = ownDockIcon()
    expect(ownDockIcon()).toBe(image)
    expect(h.createFromBuffer).toHaveBeenCalledTimes(1)
    expect(h.createFromBuffer.mock.calls[0][0]).toEqual(largestIcnsPng(icns))
  })

  it('is null in the default app', async () => {
    h.profile = null
    const { ownDockIcon } = await import('./app-profile-dock-icon')
    expect(ownDockIcon()).toBeNull()
    expect(h.createFromBuffer).not.toHaveBeenCalled()
  })
})
