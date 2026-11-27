import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newImg } from '../../shared/icon-badger/raster'
import { encodePng } from '../../cli/app-profiles/app-profile-icns'

const { createFromBuffer } = vi.hoisted(() => ({
  // A stand-in image that keeps the PNG it came from, so the test can see which entry was used.
  createFromBuffer: vi.fn((png: Buffer) => {
    const image = {
      isEmpty: () => false,
      resize: () => image,
      toPNG: () => png,
      toDataURL: () => `data:image/png;base64,${png.toString('base64')}`
    }
    return image
  })
}))
vi.mock('electron', () => ({ nativeImage: { createFromBuffer } }))

import { appIcon, withAppIcons } from './profile-manager-app-icon'

/** An .icns with one PNG entry for each size. */
function icns(sizes: number[]): Buffer {
  const entries = sizes.map((size) => {
    const png = encodePng(newImg(size, size, 4))
    const head = Buffer.alloc(8)
    head.write('ic10', 0, 'latin1')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

let root: string
let app: string

function writeApp(iconFile: string, sizes: number[]): void {
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleIconFile</key><string>${iconFile}</string></dict></plist>`
  )
  writeFileSync(join(app, 'Contents', 'Resources', `${iconFile}.icns`), icns(sizes))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-app-icon-'))
  app = join(root, 'Orca - Work.app')
  createFromBuffer.mockClear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const width = (call: number): number => createFromBuffer.mock.calls[call][0].readUInt32BE(16)
const defaultApp = (): { id: string; appPath: string; userDataPath: string } => ({
  id: 'default',
  appPath: app,
  userDataPath: join(root, 'default-data')
})
const work = (): { id: string; appPath: string; userDataPath: string } => ({
  id: 'work',
  appPath: app,
  userDataPath: join(root, 'work-data')
})
function writeKept(userDataPath: string, sizes: number[], time = Date.now()): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(join(userDataPath, 'profile-icon.icns'), icns(sizes))
  utimesSync(join(userDataPath, 'profile-icon.icns'), new Date(), new Date(time))
}

describe('appIcon', () => {
  it("uses the largest PNG of the bundle's own icon file", async () => {
    writeApp('AppIcon', [16, 64, 32])
    // A decoy at the default name: the plist names AppIcon.icns.
    writeFileSync(join(app, 'Contents', 'Resources', 'icon.icns'), icns([8]))
    const icon = await appIcon(defaultApp())
    const png = createFromBuffer.mock.calls[0][0]
    expect(width(0)).toBe(64)
    expect(icon?.list).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('shows the icon that a profile keeps, and reads it again only when set-icon writes it', async () => {
    writeApp('icon', [32])
    writeKept(work().userDataPath, [256], Date.now() - 60_000)
    await appIcon(work())
    await appIcon(work())
    expect(createFromBuffer).toHaveBeenCalledTimes(2)
    expect(width(0)).toBe(256)
    // set-icon writes the kept copy again: a new mtime. The signed bundle does not change.
    writeKept(work().userDataPath, [128])
    await appIcon(work())
    expect(createFromBuffer).toHaveBeenCalledTimes(4)
    expect(width(2)).toBe(128)
  })

  it('takes the bundle icon without a kept icon; the default app never takes a kept one', async () => {
    writeApp('icon', [32])
    await appIcon(work())
    expect(width(0)).toBe(32)
    writeKept(defaultApp().userDataPath, [256])
    createFromBuffer.mockClear()
    await appIcon({ ...defaultApp(), appPath: app })
    // The default app reads the same bundle file as before: the cached icon, no new read.
    expect(createFromBuffer).not.toHaveBeenCalled()
  })

  it('gives no icon for a missing bundle, and the state has no entry for it', async () => {
    expect(await appIcon({ ...work(), appPath: join(root, 'Gone.app') })).toBeNull()
    writeApp('icon', [32])
    const state = await withAppIcons({
      currentId: 'default',
      keptIds: [],
      rows: [
        { id: 'work', name: 'Work', appPath: app, userDataPath: '', port: 6800 },
        { id: 'gone', name: 'Gone', appPath: join(root, 'Gone.app'), userDataPath: '', port: 6832 }
      ].map((row) => ({ ...row, state: 'stopped' as const, startAtLogin: false }))
    })
    expect(Object.keys(state.icons ?? {})).toEqual(['work'])
  })
})
