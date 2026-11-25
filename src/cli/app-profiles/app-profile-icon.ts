// Profile icons: the default app's icon with a badge, or an uploaded icon, written as .icns.
// See docs/fork/profiles-design.md, section 8. The CLI runs it; electron-vite does not keep
// src/main modules for the CLI.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { ICON_STYLES, renderBadgedIcon, type IconStyle } from '../../shared/icon-badger/badger'
import type { Img } from '../../shared/icon-badger/raster'
import { decodePng, encodePng, largestIcnsPng, writeIcns } from './app-profile-icns'
import { markAlpha, menuBarPng } from './app-profile-menu-bar'
import {
  APP_PROFILE_BADGE_COLOR,
  APP_PROFILE_BADGE_FILE,
  APP_PROFILE_ICON_FILE,
  readPlistString,
  type AppProfileIcon
} from '../../shared/app-profiles/app-profile-paths'
import {
  APP_PROFILE_BADGE_SWATCHES,
  APP_PROFILE_MENU_BAR_FILE
} from '../../shared/app-profiles/app-profile-icon-files'

/** What makes a profile icon: a badge character, a badge image file or a full icon file. */
export type AppProfileIconSource =
  // No text: the name's badge (withNameBadge), else the first free character (nextBadgeText).
  | { kind: 'badge'; text?: string; style?: IconStyle; color?: string }
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

/**
 * The default badge of a profile name: its first letter or digit in upper case when no other
 * profile uses it, else nextBadgeText. The word "Orca" does not count; "Orca's" is another word.
 * The colour is a swatch (not the dark one) from a hash of the name, so each name keeps its colour.
 */
export function defaultBadge(
  name: string,
  icons: readonly (AppProfileIcon | undefined)[]
): { text: string; color: string } {
  const letter = /[\p{L}\p{N}]/u
  const first = (name.replace(/(?<![\p{L}\p{N}])orca(?![\p{L}\p{N}]|['’]\p{L})/giu, ' ').match(letter) ?? name.match(letter))?.[0] ?? ''
  // 'ß' becomes 'SS': a badge has one character.
  const upper = first.toUpperCase().length === 1 ? first.toUpperCase() : first
  const used = icons.some((icon) => icon?.kind === 'badge' && icon.text === upper)
  const text = upper && !used ? upper : nextBadgeText(icons)
  const colors = APP_PROFILE_BADGE_SWATCHES.slice(1)
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  }
  return { text, color: colors[hash % colors.length] }
}

/** A badge source without text gets the default badge of the profile name. */
export function withNameBadge(
  source: AppProfileIconSource,
  name: string,
  icons: readonly (AppProfileIcon | undefined)[]
): AppProfileIconSource {
  if (source.kind !== 'badge' || source.text !== undefined) {
    return source
  }
  const badge = defaultBadge(name, icons)
  return { ...source, text: badge.text, color: source.color ?? badge.color }
}

export function isIconStyle(value: string): value is IconStyle {
  return (ICON_STYLES as readonly string[]).includes(value)
}

/** The icon of the `--icon-badge`, `--icon-style`, `--icon-color`, `--icon-image` and `--icon-file` flags. */
export function appProfileIconSourceFromFlags(
  value: (flag: string) => string | undefined
): AppProfileIconSource | undefined {
  const text = value('--icon-badge')
  const style = value('--icon-style')
  const image = value('--icon-image')
  const file = value('--icon-file')
  const color = value('--icon-color')?.toLowerCase()
  if ([text, image, file].filter((v) => v !== undefined).length > 1) {
    throw new Error('Use only one of --icon-badge, --icon-image and --icon-file.')
  }
  if (style !== undefined && !isIconStyle(style)) {
    throw new Error(`--icon-style must be one of: ${ICON_STYLES.join(', ')}.`)
  }
  if (color !== undefined && !/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error('--icon-color must be #rrggbb, for example #2563eb.')
  }
  if (color !== undefined && text === undefined && (image ?? file) !== undefined) {
    throw new Error('--icon-color applies only to a badge character.')
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
  if (text !== undefined || style !== undefined || color !== undefined) {
    return { kind: 'badge', text, style, ...(color ? { color } : {}) }
  }
  return undefined
}

const graphemes = (text: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length

// ---------------------------------------------------------------- AppKit rasterizer

// JXA (macOS JavaScript for Automation): draws a text or an image file into a 1024 px sRGB
// bitmap and prints it as base64 PNG. AppKit has the system font, emoji and the SVG, WebP and
// ICNS decoders, so the CLI and the Profile Manager share one path.
const APPKIT_RASTERIZER = `
ObjC.import('AppKit')
function run(argv) {
  const [mode, value, hex] = argv
  const size = 1024
  let rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
  rep = rep.bitmapImageRepByRetaggingWithColorSpace($.NSColorSpace.sRGBColorSpace)
  $.NSGraphicsContext.saveGraphicsState
  const context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
  context.imageInterpolation = $.NSImageInterpolationHigh
  $.NSGraphicsContext.setCurrentContext(context)
  if (mode === 'text') {
    const font = $.NSFont.systemFontOfSizeWeight(700, $.NSFontWeightHeavy)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const color = $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1)
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

/** A 1024 x 1024 RGBA image of a text (the badge character, in `color`) or of an image file. */
export function rasterizeWithAppKit(
  mode: 'text' | 'file',
  value: string,
  run: RunTool = runTool,
  color = APP_PROFILE_BADGE_COLOR
): Img {
  let out: string
  try {
    out = run('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      APPKIT_RASTERIZER,
      mode,
      value,
      color
    ])
  } catch (error) {
    // The tool error holds the whole script; give its stderr only.
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
    const what = mode === 'file' ? `Cannot read the image ${value}` : 'AppKit cannot draw the badge'
    throw new Error(stderr ? `${what}: ${stderr}` : what)
  }
  const png = Buffer.from(out.trim(), 'base64')
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
): { icns: Buffer; icon: AppProfileIcon; badgePng?: Buffer; menuBarPng?: Buffer } {
  if (source.kind !== 'badge' && !existsSync(source.path)) {
    throw new Error(`No file ${source.path}`)
  }
  const text = source.kind === 'badge' ? (source.text ?? nextBadgeText(used)) : ''
  // One character: a wider badge does not fit under the curl (dock-icon-badger refuses it too).
  if (source.kind === 'badge' && (/^[\p{C}\p{Z}]*$/u.test(text) || graphemes(text) !== 1)) {
    throw new Error(`A badge has one visible character: ${JSON.stringify(text)}`)
  }
  if (source.kind === 'file') {
    const icns =
      extname(source.path).toLowerCase() === '.icns'
        ? readFileSync(source.path)
        : writeIcns(rasterizeWithAppKit('file', source.path, run))
    const png = largestIcnsPng(icns)
    const img = png && decodePng(png)
    // An own icon: the icon alone, no glyph.
    const menuBar = img ? menuBarPng(defaultAppPath, markAlpha(img, true), false) : undefined
    return { icns, icon: { kind: 'file' }, menuBarPng: menuBar }
  }
  const style = source.style ?? 'ref-match'
  const badge =
    source.kind === 'badge'
      ? rasterizeWithAppKit('text', text, run, source.color)
      : rasterizeWithAppKit('file', source.path, run)
  const img = renderBadgedIcon(readAppIcon(defaultAppPath, run), badge, style)
  // A character: its shape only. An image: its dark parts.
  const menuBar = menuBarPng(defaultAppPath, markAlpha(badge, source.kind === 'image'))
  if (source.kind === 'badge') {
    const color = source.color ? { color: source.color } : {}
    return {
      icns: writeIcns(img),
      icon: { kind: 'badge', text, style, ...color },
      menuBarPng: menuBar
    }
  }
  return {
    icns: writeIcns(img),
    icon: { kind: 'image', style },
    badgePng: encodePng(badge),
    menuBarPng: menuBar
  }
}

/**
 * Keeps the icon, an uploaded badge and the menu-bar template in the profile's userData. The Edit
 * form reads the first two; the profile app reads the icon and the template.
 */
export function keepProfileIcon(
  userDataPath: string,
  made: { icns: Buffer; badgePng?: Buffer; menuBarPng?: Buffer }
): void {
  for (const [name, bytes] of [
    [APP_PROFILE_ICON_FILE, made.icns],
    [APP_PROFILE_BADGE_FILE, made.badgePng],
    [APP_PROFILE_MENU_BAR_FILE, made.menuBarPng]
  ] as const) {
    // Kept data can hold a link here; the write must not follow it.
    rmSync(join(userDataPath, name), { force: true })
    if (bytes) {
      writeFileSync(join(userDataPath, name), bytes)
    }
  }
}
