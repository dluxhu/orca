// The menu-bar (tray) template of a profile icon: docs/fork/profiles-design.md, section 8.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bbox, crop, newImg, type Img } from '../../shared/icon-badger/raster'
import { resize } from '../../shared/icon-badger/resample'
import { decodePng, encodePng } from './app-profile-icns'

const TRAY_GLYPH = ['app.asar.unpacked', 'resources', 'tray', 'orca-menu-barTemplate@2x.png']
/** The height of the template at 2x when there is no glyph. */
const MENU_BAR_HEIGHT = 28
const MENU_BAR_GAP = 4

/** The Orca menu-bar glyph of the default app at 2x, or null. */
function readTrayGlyph(appPath: string): Img | null {
  try {
    return decodePng(readFileSync(join(appPath, 'Contents', 'Resources', ...TRAY_GLYPH)))
  } catch {
    return null
  }
}

/** The alpha of an RGBA image, times its darkness when `dark` is true. */
export function markAlpha(img: Img, dark: boolean): Img {
  const out = newImg(img.width, img.height, 1)
  for (let i = 0; i < out.data.length; i++) {
    const [r, g, b, a] = img.data.subarray(i * 4, i * 4 + 4)
    const darkness = dark ? 255 - (r * 299 + g * 587 + b * 114) / 1000 : 255
    out.data[i] = Math.round((a * darkness) / 255)
  }
  return out
}

/**
 * The menu-bar template at 2x, black with alpha: the Orca glyph, then the mark at the glyph's
 * height. No glyph: the mark alone. Null when the mark is empty.
 */
export function menuBarTemplate(mark: Img, glyph: Img | null): Img | null {
  const box = bbox(mark)
  if (!box) {
    return null
  }
  const cut = crop(mark, ...box)
  const height = glyph?.height ?? MENU_BAR_HEIGHT
  const width = Math.max(1, Math.round((cut.width * height) / cut.height))
  const sized = resize(cut, width, height)
  const left = glyph ? glyph.width + MENU_BAR_GAP : 0
  const out = newImg(left + width, height, 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; glyph && x < glyph.width; x++) {
      out.data[(y * out.width + x) * 4 + 3] = glyph.data[(y * glyph.width + x) * 4 + 3]
    }
    for (let x = 0; x < width; x++) {
      out.data[(y * out.width + left + x) * 4 + 3] = sized.data[y * width + x]
    }
  }
  return out
}

/** The template of an icon as PNG: the mark next to the default app's glyph, or alone. */
export function menuBarPng(
  defaultAppPath: string,
  mark: Img,
  withGlyph = true
): Buffer | undefined {
  const img = menuBarTemplate(mark, withGlyph ? readTrayGlyph(defaultAppPath) : null)
  return img ? encodePng(img) : undefined
}
