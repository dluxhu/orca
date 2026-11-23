import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bbox, newImg } from '../../shared/icon-badger/raster'
import {
  appProfileIconFlags,
  appProfileIconSourceFromFlags,
  makeAppProfileIcon,
  nextBadgeText,
  rasterizeWithAppKit
} from './app-profile-icon'
import { decodePng, encodePng, largestIcnsPng, writeIcns } from './app-profile-icns'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-icon-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const flags = (values: Record<string, string>) =>
  appProfileIconSourceFromFlags((flag) => values[flag])

describe('profile icon sources', () => {
  it('takes the first free character of 2 to 9, then A to Z', () => {
    expect(nextBadgeText([])).toBe('2')
    expect(
      nextBadgeText([{ kind: 'badge', text: '2', style: 'ref-match' }, { kind: 'file' }])
    ).toBe('3')
    const digits = [...'23456789'].map((text) => ({
      kind: 'badge' as const,
      text,
      style: 'ref-match' as const
    }))
    expect(nextBadgeText(digits)).toBe('A')
  })

  it('reads the --icon flags', () => {
    expect(flags({})).toBeUndefined()
    expect(flags({ '--icon-badge': 'Q' })).toEqual({ kind: 'badge', text: 'Q', style: undefined })
    expect(flags({ '--icon-style': 'ref-match-bigger' })).toEqual({
      kind: 'badge',
      text: undefined,
      style: 'ref-match-bigger'
    })
    expect(flags({ '--icon-image': 'logo.svg', '--icon-style': 'ref-match' })).toMatchObject({
      kind: 'image',
      style: 'ref-match'
    })
    expect(flags({ '--icon-file': '/x/icon.icns' })).toEqual({ kind: 'file', path: '/x/icon.icns' })
    expect(() => flags({ '--icon-badge': 'Q', '--icon-file': 'a.png' })).toThrow('only one')
    expect(() => flags({ '--icon-style': 'wavy' })).toThrow(
      'must be one of: ref-match, ref-match-bigger'
    )
    expect(() => flags({ '--icon-file': 'a.png', '--icon-style': 'ref-match' })).toThrow(
      'does not apply'
    )
  })

  it('writes the --icon flags that it reads back', () => {
    for (const source of [
      { kind: 'badge', text: 'Q', style: 'ref-match-bigger' },
      { kind: 'badge', text: undefined, style: 'ref-match' },
      { kind: 'image', path: '/x/logo.svg', style: 'ref-match' },
      { kind: 'file', path: '/x/icon.icns' }
    ] as const) {
      const args = appProfileIconFlags(source)
      const values = new Map(args.flatMap((arg, i) => (i % 2 === 0 ? [[arg, args[i + 1]]] : [])))
      expect(flags(Object.fromEntries(values))).toEqual(source)
    }
    expect(appProfileIconFlags(undefined)).toEqual([])
  })

  it('refuses a badge that is not one visible character, and a missing file', () => {
    const app = join(dir, 'none.app')
    for (const text of ['', ' ', 'AB', '\u200b', '\u0007', '\u00a0']) {
      expect(() => makeAppProfileIcon(app, { kind: 'badge', text })).toThrow(
        'A badge has one visible character'
      )
    }
    expect(() => makeAppProfileIcon(app, { kind: 'file', path: join(dir, 'x.png') })).toThrow(
      'No file'
    )
  })
})

describe('PNG and .icns', () => {
  it('reads back the PNG it writes', () => {
    const img = newImg(3, 2, 4)
    img.data.set([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(decodePng(encodePng(img))).toEqual(img)
  })

  it('writes the ten iconset sizes, each with its OSType; the largest is 1024 px', () => {
    const icns = writeIcns(newImg(1024, 1024, 4, [10, 20, 30, 255]))
    expect(icns.toString('latin1', 0, 4)).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    const entries: [string, number][] = []
    for (let offset = 8; offset < icns.length; offset += icns.readUInt32BE(offset + 4)) {
      // The PNG width is in IHDR, 16 bytes into the PNG.
      entries.push([
        icns.toString('latin1', offset, offset + 4),
        icns.readUInt32BE(offset + 8 + 16)
      ])
    }
    expect(entries).toEqual([
      ['icp4', 16],
      ['ic11', 32],
      ['icp5', 32],
      ['ic12', 64],
      ['ic07', 128],
      ['ic13', 256],
      ['ic08', 256],
      ['ic14', 512],
      ['ic09', 512],
      ['ic10', 1024]
    ])
    const largest = decodePng(largestIcnsPng(icns)!)!
    expect([largest.width, largest.height]).toEqual([1024, 1024])
    expect([...largest.data.subarray(0, 4)]).toEqual([10, 20, 30, 255])
  })
})

describe.skipIf(process.platform !== 'darwin')('AppKit and the whole icon', () => {
  // The text is drawn by AppKit, not by Pillow, so only the glyph box is checked (design, section 8).
  it('names the file, not the script, when AppKit cannot read an image', () => {
    const path = join(dir, 'not-an-image.png')
    writeFileSync(path, 'text')
    let message = ''
    try {
      rasterizeWithAppKit('file', path)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(`Cannot read the image ${path}`)
    expect(message).not.toContain('ObjC.import')
  })

  it('draws the badge character in the middle of a 1024 px image', () => {
    const box = bbox(rasterizeWithAppKit('text', '2'))!
    const [x0, y0, x1, y1] = box
    expect(y1 - y0).toBeGreaterThan(450)
    expect(y1 - y0).toBeLessThan(700)
    expect(Math.abs((x0 + x1) / 2 - 512)).toBeLessThan(40)
    expect(Math.abs((y0 + y1) / 2 - 512)).toBeLessThan(120)
  })

  it('badges the Orca icon and writes an .icns that macOS reads', { timeout: 120_000 }, () => {
    const app = join(dir, 'Orca.app')
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(
      join(app, 'Contents', 'Info.plist'),
      '<plist><dict><key>CFBundleIconFile</key><string>icon</string></dict></plist>'
    )
    copyFileSync(
      join(__dirname, '..', '..', '..', 'resources', 'build', 'icon.icns'),
      join(app, 'Contents', 'Resources', 'icon.icns')
    )
    const made = makeAppProfileIcon(app, { kind: 'badge' }, [
      { kind: 'badge', text: '2', style: 'ref-match' }
    ])
    expect(made.icon).toEqual({ kind: 'badge', text: '3', style: 'ref-match' })
    const icns = join(dir, 'profile.icns')
    writeFileSync(icns, made.icns)
    execFileSync('/usr/bin/iconutil', ['-c', 'iconset', '-o', join(dir, 'out.iconset'), icns])
    expect(readdirSync(join(dir, 'out.iconset')).sort()).toEqual([
      'icon_128x128.png',
      'icon_128x128@2x.png',
      'icon_16x16.png',
      'icon_16x16@2x.png',
      'icon_256x256.png',
      'icon_256x256@2x.png',
      'icon_32x32.png',
      'icon_32x32@2x.png',
      'icon_512x512.png',
      'icon_512x512@2x.png'
    ])
  })
})
