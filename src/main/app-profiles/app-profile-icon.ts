// Profile icons: the default app's icon with a badge, or an uploaded icon, written as .icns.
// See docs/fork/profiles-design.md, section 8. Runs in Node (the CLI and the main process).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { ICON_STYLES, renderBadgedIcon, type IconStyle } from '../../shared/icon-badger/badger'
import type { Img } from '../../shared/icon-badger/raster'
import { LANCZOS, resize } from '../../shared/icon-badger/resample'
import { readPlistString, type AppProfileIcon } from '../../shared/app-profiles/app-profile-paths'

/** What makes a profile icon: a badge character, a badge image file or a full icon file. */
export type AppProfileIconSource =
  // No text: the first free character (nextBadgeText).
  | { kind: 'badge'; text?: string; style?: IconStyle }
  | { kind: 'image'; path: string; style?: IconStyle }
  | { kind: 'file'; path: string }

type RunTool = (program: string, args: string[]) => string

const runTool: RunTool = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  })

const BADGE_CHARACTERS = [...'23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ']

/** The first of 2 to 9, then A to Z, that no profile uses as its badge. */
export function nextBadgeText(icons: readonly (AppProfileIcon | undefined)[]): string {
  const used = new Set(icons.map((icon) => (icon?.kind === 'badge' ? icon.text : null)))
  return BADGE_CHARACTERS.find((text) => !used.has(text)) ?? '2'
}

export function isIconStyle(value: string): value is IconStyle {
  return (ICON_STYLES as readonly string[]).includes(value)
}

/** The icon of the `--icon-badge`, `--icon-style`, `--icon-image` and `--icon-file` flags. */
export function appProfileIconSourceFromFlags(
  value: (flag: string) => string | undefined
): AppProfileIconSource | undefined {
  const text = value('--icon-badge')
  const style = value('--icon-style')
  const image = value('--icon-image')
  const file = value('--icon-file')
  if ([text, image, file].filter((v) => v !== undefined).length > 1) {
    throw new Error('Use only one of --icon-badge, --icon-image and --icon-file.')
  }
  if (style !== undefined && !isIconStyle(style)) {
    throw new Error(`--icon-style must be one of: ${ICON_STYLES.join(', ')}.`)
  }
  if (file !== undefined) {
    if (style !== undefined) {
      throw new Error('--icon-style does not apply to --icon-file.')
    }
    return { kind: 'file', path: resolve(file) }
  }
  if (image !== undefined) {
    return { kind: 'image', path: resolve(image), style }
  }
  if (text !== undefined || style !== undefined) {
    return { kind: 'badge', text, style }
  }
  return undefined
}

const graphemes = (text: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length)
  head.write(type, 4, 'latin1')
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0)
  return Buffer.concat([head, data, sum])
}

/** An 8-bit RGBA PNG. */
export function encodePng(img: Img): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Decodes an 8-bit RGB or RGBA PNG without interlace; null for any other PNG. */
export function decodePng(png: Buffer): Img | null {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) {
        return null
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let pred = 0
      if (filter === 1) {
        pred = a
      } else if (filter === 2) {
        pred = b
      } else if (filter === 3) {
        pred = (a + b) >> 1
      } else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = (line[i] + pred) & 0xff
    }
  }
  if (bpp === 4) {
    return { width, height, channels: 4, data: pixels }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data.set(pixels.subarray(i * 3, i * 3 + 3), i * 4)
    data[i * 4 + 3] = 255
  }
  return { width, height, channels: 4, data }
}

// ---------------------------------------------------------------- .icns

// The iconset sizes and their types, as `write_icns` in dock_icon_badger.py writes them.
const ICNS_ENTRIES: [type: string, pixels: number][] = [
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
]

/** An .icns file with one PNG entry for each iconset size. */
export function writeIcns(img: Img): Buffer {
  const entries = ICNS_ENTRIES.map(([type, pixels]) => {
    const png = encodePng(resize(img, pixels, pixels, LANCZOS))
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** The largest PNG entry of an .icns file, or null. */
export function largestIcnsPng(icns: Buffer): Buffer | null {
  let best: Buffer | null = null
  let bestWidth = 0
  for (let offset = 8; offset + 8 <= icns.length;) {
    const length = icns.readUInt32BE(offset + 4)
    if (length < 8) {
      break
    }
    const data = icns.subarray(offset + 8, offset + length)
    if (data.subarray(0, 8).equals(PNG_SIGNATURE) && data.readUInt32BE(16) > bestWidth) {
      best = data
      bestWidth = data.readUInt32BE(16)
    }
    offset += length
  }
  return best
}

// ---------------------------------------------------------------- AppKit rasterizer

// JXA (macOS JavaScript for Automation): draws a text or an image file into a 1024 px sRGB
// bitmap and prints it as base64 PNG. AppKit has the system font, emoji and the SVG, WebP and
// ICNS decoders, so the CLI and the Profile Manager share one path.
const APPKIT_RASTERIZER = `
ObjC.import('AppKit')
function run(argv) {
  const [mode, value] = argv
  const size = 1024
  let rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
  rep = rep.bitmapImageRepByRetaggingWithColorSpace($.NSColorSpace.sRGBColorSpace)
  $.NSGraphicsContext.saveGraphicsState
  const context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
  context.imageInterpolation = $.NSImageInterpolationHigh
  $.NSGraphicsContext.setCurrentContext(context)
  if (mode === 'text') {
    const font = $.NSFont.systemFontOfSizeWeight(700, $.NSFontWeightHeavy)
    const color = $.NSColor.colorWithSRGBRedGreenBlueAlpha(15 / 255, 23 / 255, 42 / 255, 1)
    const attrs = $({ NSFont: font, NSColor: color })
    const text = $(value)
    const box = text.sizeWithAttributes(attrs)
    text.drawAtPointWithAttributes($.NSMakePoint((size - box.width) / 2, (size - box.height) / 2), attrs)
  } else {
    const image = $.NSImage.alloc.initWithContentsOfFile(value)
    if (image.isNil()) throw new Error('Cannot read the image ' + value)
    const w = image.size.width
    const h = image.size.height
    const scale = size / Math.max(w, h)
    image.drawInRectFromRectOperationFraction($.NSMakeRect((size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
  }
  $.NSGraphicsContext.restoreGraphicsState
  return rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).base64EncodedStringWithOptions(0).js
}
`

/** A 1024 x 1024 RGBA image of a text (the badge character) or of an image file. */
export function rasterizeWithAppKit(
  mode: 'text' | 'file',
  value: string,
  run: RunTool = runTool
): Img {
  const png = Buffer.from(
    run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', APPKIT_RASTERIZER, mode, value]).trim(),
    'base64'
  )
  const img = decodePng(png)
  if (!img) {
    throw new Error('AppKit returned an image that Orca cannot read.')
  }
  return img
}

// ---------------------------------------------------------------- profile icon

/** The file name of an app's icon in Contents/Resources, from its Info.plist XML. */
export function appIconFileName(plistXml: string): string {
  const name = readPlistString(plistXml, 'CFBundleIconFile') ?? 'icon.icns'
  return name.endsWith('.icns') ? name : `${name}.icns`
}

/** The default app's own icon at 1024 px. */
export function readAppIcon(appPath: string, run: RunTool = runTool): Img {
  const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  const path = join(appPath, 'Contents', 'Resources', appIconFileName(plist))
  const png = largestIcnsPng(readFileSync(path))
  const img = png && decodePng(png)
  return img && img.width === 1024 ? img : rasterizeWithAppKit('file', path, run)
}

/**
 * The .icns of a profile icon, and the registry `icon` field that describes it. `used` holds the
 * icons of the other profiles, for the default badge character.
 */
export function makeAppProfileIcon(
  defaultAppPath: string,
  source: AppProfileIconSource,
  used: readonly (AppProfileIcon | undefined)[] = [],
  run: RunTool = runTool
): { icns: Buffer; icon: AppProfileIcon } {
  if (source.kind !== 'badge' && !existsSync(source.path)) {
    throw new Error(`No file ${source.path}`)
  }
  const text = source.kind === 'badge' ? (source.text ?? nextBadgeText(used)) : ''
  // One character: a wider badge does not fit under the curl (dock-icon-badger refuses it too).
  if (source.kind === 'badge' && (!text.trim() || graphemes(text) !== 1)) {
    throw new Error(`A badge has one character: "${text}"`)
  }
  if (source.kind === 'file') {
    const icns =
      extname(source.path).toLowerCase() === '.icns'
        ? readFileSync(source.path)
        : writeIcns(rasterizeWithAppKit('file', source.path, run))
    return { icns, icon: { kind: 'file' } }
  }
  const style = source.style ?? 'ref-match'
  const badge =
    source.kind === 'badge'
      ? rasterizeWithAppKit('text', text, run)
      : rasterizeWithAppKit('file', source.path, run)
  const img = renderBadgedIcon(readAppIcon(defaultAppPath, run), badge, style)
  const icon: AppProfileIcon =
    source.kind === 'badge' ? { kind: 'badge', text, style } : { kind: 'image', style }
  return { icns: writeIcns(img), icon }
}
