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

describe('appIcon', () => {
  it("uses the largest PNG of the bundle's own icon file", async () => {
    writeApp('AppIcon', [16, 64, 32])
    // A decoy at the default name: the plist names AppIcon.icns.
    writeFileSync(join(app, 'Contents', 'Resources', 'icon.icns'), icns([8]))
    const icon = await appIcon(app)
    const png = createFromBuffer.mock.calls[0][0]
    expect(png.readUInt32BE(16)).toBe(64)
    expect(icon?.list).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('reads the files again only when the icon file changes', async () => {
    writeApp('icon', [32])
    await appIcon(app)
    await appIcon(app)
    expect(createFromBuffer).toHaveBeenCalledTimes(2)
    // A set-icon writes a new file: a new mtime.
    writeFileSync(join(app, 'Contents', 'Resources', 'icon.icns'), icns([128]))
    utimesSync(
      join(app, 'Contents', 'Resources', 'icon.icns'),
      new Date(),
      new Date(Date.now() + 5000)
    )
    await appIcon(app)
    expect(createFromBuffer).toHaveBeenCalledTimes(4)
    expect(createFromBuffer.mock.calls[2][0].readUInt32BE(16)).toBe(128)
  })

  it('gives no icon for a missing bundle, and the state has no entry for it', async () => {
    expect(await appIcon(join(root, 'Gone.app'))).toBeNull()
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
