import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bbox, newImg } from '../../shared/icon-badger/raster'
import { appProfileIconFlags } from '../../shared/app-profiles/app-profile-rules'
import {
  appProfileIconSourceFromFlags,
  defaultBadge,
  keepProfileIcon,
  makeAppProfileIcon,
  nextBadgeText,
  rasterizeWithAppKit,
  withNameBadge
} from './app-profile-icon'
import { decodePng, encodePng, largestIcnsPng, writeIcns } from './app-profile-icns'
import { markAlpha, menuBarPng, menuBarTemplate } from './app-profile-menu-bar'

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

  it('takes the default badge from the name: its first letter or digit, a colour from its hash', () => {
    const q = { kind: 'badge' as const, text: 'W', style: 'ref-match' as const }
    expect(defaultBadge('Work', [])).toEqual({ text: 'W', color: '#9333ea' })
    expect(defaultBadge('Home', [{ kind: 'file' }])).toEqual({ text: 'H', color: '#2563eb' })
    expect(defaultBadge('2nd', [])).toEqual({ text: '2', color: '#dc2626' })
    // The word "Orca" does not count, unless the name has nothing else.
    expect(defaultBadge('Orca - Work', []).text).toBe('W')
    expect(defaultBadge('Orcas', []).text).toBe('O')
    expect(defaultBadge('Orca', []).text).toBe('O')
    // A word boundary for every script; an apostrophe and a letter belong to the word.
    expect(defaultBadge('Orcaé', []).text).toBe('O')
    expect(defaultBadge("Orca's Lab", []).text).toBe('O')
    expect(defaultBadge('Orca’s Lab', []).text).toBe('O')
    expect(defaultBadge("Orca' Lab", []).text).toBe('L')
    expect(defaultBadge('ünited', []).text).toBe('Ü')
    // One character: 'ß' stays as it is.
    expect(defaultBadge('ß', []).text).toBe('ß')
    // A taken letter, and a name without a letter, get the first free character.
    expect(defaultBadge('Wild', [q])).toEqual({ text: '2', color: '#dc2626' })
    expect(defaultBadge('--', []).text).toBe('2')
    // The colour is never the dark default, and it does not change between calls.
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'Orca - Work']) {
      expect(defaultBadge(name, []).color).not.toBe('#0f172a')
      expect(defaultBadge(name, [q])).toEqual(defaultBadge(name, [q]))
    }
  })

  it('gives a badge source without text the badge of the name; keeps explicit values', () => {
    expect(withNameBadge({ kind: 'badge' }, 'Work', [])).toEqual({
      kind: 'badge',
      text: 'W',
      color: '#9333ea'
    })
    expect(withNameBadge({ kind: 'badge', style: 'round', color: '#16a34a' }, 'Work', [])).toEqual({
      kind: 'badge',
      text: 'W',
      style: 'round',
      color: '#16a34a'
    })
    expect(withNameBadge({ kind: 'badge', text: 'Q' }, 'Work', [])).toEqual({
      kind: 'badge',
      text: 'Q'
    })
    const file = { kind: 'file' as const, path: '/x.icns' }
    expect(withNameBadge(file, 'Work', [])).toBe(file)
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
      { kind: 'badge', text: 'Q', style: 'ref-match', color: '#2563eb' },
      { kind: 'badge', text: undefined, style: 'ref-match' },
      { kind: 'image', path: '/x/logo.svg', style: 'ref-match' },
      { kind: 'file', path: '/x/icon.icns' },
      { kind: 'badge', text: 'Q', style: 'ref-match', base: 'blue' },
      { kind: 'image', path: '/x/logo.svg', style: 'ref-match', base: '/x/base.png' },
      { kind: 'none', base: 'watercolor' },
      { kind: 'none', base: 'classic' }
    ] as const) {
      const args = appProfileIconFlags(source)
      // As the CLI parses them: --no-badge has no value.
      const values: Record<string, string> = {}
      for (let i = 0; i < args.length; i++) {
        values[args[i]] = args[i] === '--no-badge' ? '' : args[++i]
      }
      expect(flags(values)).toEqual(source)
    }
    // classic is the default app's own icon: no flag.
    expect(appProfileIconFlags({ kind: 'badge', text: 'Q', base: 'classic' })).toEqual([
      '--icon-badge',
      'Q'
    ])
    expect(appProfileIconFlags(undefined)).toEqual([])
  })

  it('reads --icon-base and --no-badge: a built-in id or a file, with or without a badge', () => {
    expect(flags({ '--icon-base': 'blue' })).toEqual({
      kind: 'badge',
      text: undefined,
      style: undefined,
      base: 'blue'
    })
    expect(flags({ '--icon-base': '/x/base.png', '--icon-badge': 'Q' })).toMatchObject({
      kind: 'badge',
      text: 'Q',
      base: '/x/base.png'
    })
    expect(flags({ '--no-badge': '' })).toEqual({ kind: 'none', base: 'classic' })
    expect(flags({ '--no-badge': '', '--icon-base': 'blue' })).toEqual({
      kind: 'none',
      base: 'blue'
    })
    // An uploaded base alone is the whole icon.
    expect(flags({ '--no-badge': '', '--icon-base': '/x/base.png' })).toEqual({
      kind: 'file',
      path: '/x/base.png'
    })
    expect(() => flags({ '--no-badge': '', '--icon-badge': 'Q' })).toThrow('only one')
    expect(() => flags({ '--no-badge': '', '--icon-style': 'ref-match' })).toThrow('need a badge')
    expect(() => flags({ '--icon-file': '/x/a.png', '--icon-base': 'blue' })).toThrow(
      'does not apply'
    )
  })

  it('reads --icon-color as a #rrggbb colour of a badge character', () => {
    expect(flags({ '--icon-badge': 'Q', '--icon-color': '#DC2626' })).toEqual({
      kind: 'badge',
      text: 'Q',
      style: undefined,
      color: '#dc2626'
    })
    expect(flags({ '--icon-color': '#2563eb' })).toMatchObject({ kind: 'badge', color: '#2563eb' })
    for (const color of ['red', '#fff', '#12345g', '2563eb', '#2563eb00']) {
      expect(() => flags({ '--icon-color': color })).toThrow('--icon-color must be #rrggbb')
    }
    expect(() => flags({ '--icon-image': 'a.png', '--icon-color': '#2563eb' })).toThrow(
      '--icon-color applies only to a badge character'
    )
    expect(() => flags({ '--icon-file': 'a.png', '--icon-color': '#2563eb' })).toThrow(
      '--icon-color applies only to a badge character'
    )
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
    // An own .icns must be one, with a PNG entry for the preview and the Dock.
    const text = join(dir, 'text.icns')
    writeFileSync(text, 'hello, I am text')
    const empty = join(dir, 'empty.icns')
    writeFileSync(empty, Buffer.from([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8]))
    for (const path of [text, empty]) {
      expect(() => makeAppProfileIcon(app, { kind: 'file', path })).toThrow(
        'Not an .icns file with a PNG image'
      )
    }
    const good = join(dir, 'good.icns')
    writeFileSync(good, writeIcns(newImg(1024, 1024, 4, [1, 2, 3, 255])))
    expect(makeAppProfileIcon(app, { kind: 'file', path: good }).icon).toEqual({ kind: 'file' })
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

describe('menu-bar template', () => {
  // An RGBA image with one opaque block of one colour.
  const block = (w: number, h: number, box: number[], rgba: number[]) => {
    const img = newImg(w, h, 4)
    for (let y = box[1]; y < box[3]; y++) {
      for (let x = box[0]; x < box[2]; x++) {
        img.data.set(rgba, (y * w + x) * 4)
      }
    }
    return img
  }
  const alphaAt = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
    img.data[(y * img.width + x) * 4 + 3]

  it('takes the alpha of a mark, times its darkness for an image', () => {
    const img = newImg(3, 1, 4)
    img.data.set([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 128])
    expect([...markAlpha(img, false).data]).toEqual([255, 255, 128])
    expect([...markAlpha(img, true).data]).toEqual([255, 0, 128])
  })

  it('puts the mark, cut to its box and at the glyph height, right of the glyph; all black', () => {
    const glyph = block(44, 28, [0, 0, 44, 28], [0, 0, 0, 200])
    const mark = markAlpha(block(100, 100, [10, 20, 30, 60], [9, 9, 9, 255]), false)
    const out = menuBarTemplate(mark, glyph)!
    // 20 x 40 scales to 14 x 28; 4 px gap.
    expect([out.width, out.height]).toEqual([44 + 4 + 14, 28])
    expect(alphaAt(out, 0, 0)).toBe(200)
    expect(alphaAt(out, 45, 14)).toBe(0)
    expect(alphaAt(out, 54, 14)).toBe(255)
    for (let i = 0; i < out.data.length; i += 4) {
      expect([...out.data.subarray(i, i + 3)]).toEqual([0, 0, 0])
    }
    // No glyph: the mark alone, 28 px high. An empty mark has no template.
    const alone = menuBarTemplate(mark, null)!
    expect([alone.width, alone.height]).toEqual([14, 28])
    expect(menuBarTemplate(newImg(4, 4, 1), glyph)).toBeNull()
  })

  it("reads the default app's tray glyph; without the file, the mark is alone", () => {
    const app = join(dir, 'Orca.app')
    const tray = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'resources', 'tray')
    const mark = markAlpha(block(10, 10, [0, 0, 10, 10], [0, 0, 0, 255]), false)
    expect(decodePng(menuBarPng(app, mark)!)!.width).toBe(28)
    mkdirSync(tray, { recursive: true })
    copyFileSync(
      join(__dirname, '..', '..', '..', 'resources', 'tray', 'orca-menu-barTemplate@2x.png'),
      join(tray, 'orca-menu-barTemplate@2x.png')
    )
    expect(decodePng(menuBarPng(app, mark)!)!.width).toBe(44 + 4 + 28)
    expect(decodePng(menuBarPng(app, mark, false)!)!.width).toBe(28)
  })

  it('makes the template of an own icon file from the icon alone, and keeps it in userData', () => {
    const app = join(dir, 'Orca.app')
    const path = join(dir, 'own.icns')
    // 1024 px, the largest entry: no upscale, so no resampling ringing widens the box.
    writeFileSync(path, writeIcns(block(1024, 1024, [256, 0, 768, 1024], [0, 0, 0, 255])))
    const made = makeAppProfileIcon(app, { kind: 'file', path })
    const template = decodePng(made.menuBarPng!)!
    expect([template.width, template.height]).toEqual([14, 28])
    const userData = join(dir, 'work')
    mkdirSync(userData)
    keepProfileIcon(userData, made)
    expect(readFileSync(join(userData, 'profile-menu-bar@2x.png'))).toEqual(made.menuBarPng)
    keepProfileIcon(userData, { icns: made.icns })
    expect(existsSync(join(userData, 'profile-menu-bar@2x.png'))).toBe(false)
  })
})

describe('base icons', () => {
  const plain = (rgba: number[]) => {
    const img = newImg(1024, 1024, 4)
    for (let i = 0; i < 1024 * 1024; i++) {
      img.data.set(rgba, i * 4)
    }
    return img
  }
  /** A default app with its own icon and the built-in icons, as electron-builder unpacks them. */
  const fakeApp = (): string => {
    const app = join(dir, 'Orca.app')
    const icons = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'resources', 'app-icons')
    mkdirSync(icons, { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist><dict></dict></plist>')
    writeFileSync(join(app, 'Contents', 'Resources', 'icon.icns'), writeIcns(plain([1, 1, 1, 255])))
    writeFileSync(join(icons, 'orca-blue.png'), encodePng(plain([0, 0, 200, 255])))
    writeFileSync(join(icons, 'orca-watercolor-mac.png'), encodePng(plain([0, 200, 0, 255])))
    return app
  }
  const firstPixel = (icns: Buffer) => [...decodePng(largestIcnsPng(icns)!)!.data.subarray(0, 4)]

  it('makes an icon with no badge from a built-in base, with no menu-bar template', () => {
    const app = fakeApp()
    const blue = makeAppProfileIcon(app, { kind: 'none', base: 'blue' })
    expect(blue.icon).toEqual({ kind: 'none', base: 'blue' })
    expect(firstPixel(blue.icns)).toEqual([0, 0, 200, 255])
    expect(blue.menuBarPng).toBeUndefined()
    expect(firstPixel(makeAppProfileIcon(app, { kind: 'none', base: 'watercolor' }).icns)).toEqual([
      0, 200, 0, 255
    ])
    expect(firstPixel(makeAppProfileIcon(app, { kind: 'none', base: 'classic' }).icns)).toEqual([
      1, 1, 1, 255
    ])
  })

  it(
    'badges an uploaded base, records it as custom and keeps its copy',
    { timeout: 120_000 },
    () => {
      const app = fakeApp()
      const base = join(dir, 'base.png')
      writeFileSync(base, 'any image')
      // AppKit stands in: the badge text and the uploaded file each come back as an image.
      const drawn: string[] = []
      const run = (_program: string, args: string[]): string => {
        drawn.push(args.at(-3) ?? '')
        return encodePng(plain(args.includes('text') ? [0, 0, 0, 255] : [200, 0, 0, 255])).toString(
          'base64'
        )
      }
      const made = makeAppProfileIcon(app, { kind: 'badge', text: 'Q', base }, [], run)
      expect(made.icon).toEqual({ kind: 'badge', text: 'Q', style: 'ref-match', base: 'custom' })
      expect(drawn).toEqual(['text', 'file'])
      expect(decodePng(made.basePng!)!.data.subarray(0, 4)).toEqual(
        new Uint8Array([200, 0, 0, 255])
      )
      const userData = join(dir, 'work')
      mkdirSync(userData)
      keepProfileIcon(userData, made)
      expect(readFileSync(join(userData, 'profile-icon-base.png'))).toEqual(made.basePng)
      // A built-in base keeps no copy, and removes an old one.
      keepProfileIcon(userData, makeAppProfileIcon(app, { kind: 'none', base: 'blue' }))
      expect(existsSync(join(userData, 'profile-icon-base.png'))).toBe(false)
    }
  )

  it('names a missing uploaded base', () => {
    expect(() =>
      makeAppProfileIcon(fakeApp(), { kind: 'badge', text: 'Q', base: join(dir, 'gone.png') })
    ).toThrow('No file')
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

  it('draws the badge character in the given colour, else in the default dark colour', () => {
    // The colour of the most opaque pixel: the glyph inside, not its anti-aliased edge.
    const ink = (color?: string): number[] => {
      const { data } = rasterizeWithAppKit('text', 'X', undefined, color)
      let best = 0
      for (let p = 3; p < data.length; p += 4) {
        if (data[p] > data[best + 3]) {
          best = p - 3
        }
      }
      return [...data.subarray(best, best + 3)]
    }
    expect(ink('#dc2626')).toEqual([0xdc, 0x26, 0x26])
    expect(ink()).toEqual([0x0f, 0x17, 0x2a])
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
    // The real tools, with their arguments kept: the badge drawing must get the colour.
    const calls: string[][] = []
    const run = (program: string, args: string[]): string => {
      calls.push(args)
      return execFileSync(program, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    }
    const made = makeAppProfileIcon(
      app,
      { kind: 'badge', color: '#2563eb' },
      [{ kind: 'badge', text: '2', style: 'ref-match' }],
      run
    )
    expect(made.icon).toEqual({ kind: 'badge', text: '3', style: 'ref-match', color: '#2563eb' })
    expect(calls.find((args) => args.includes('text'))?.slice(-2)).toEqual(['3', '#2563eb'])
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
