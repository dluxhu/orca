// The badge image: trimmed, its white background made transparent, its holes filled.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, so a diff against
// dock_icon_badger.py stays easy.
import {
  type Img,
  alphaComposite,
  bbox,
  channel,
  cloneImg,
  crop,
  floodFill,
  lighter,
  maxFilter,
  multiply,
  newImg,
  point,
  putAlpha
} from './raster'
import { gaussianBlur, resize } from './resample'
import { pyRound } from './py'

/** Make a white background transparent (flood fill from the corners); keeps interior whites. */
export function keyOutWhite(im: Img, thr = 242): Img {
  const m = newImg(im.width, im.height, 1)
  for (let i = 0; i < m.data.length; i++) {
    const p = i * 4
    m.data[i] = Math.min(im.data[p], im.data[p + 1], im.data[p + 2]) >= thr ? 255 : 0
  }
  for (const [x, y] of [
    [0, 0],
    [m.width - 1, 0],
    [0, m.height - 1],
    [m.width - 1, m.height - 1]
  ]) {
    if (m.data[y * m.width + x] === 255) {
      floodFill(m, x, y, 128)
    }
  }
  const alpha = gaussianBlur(
    point(m, (v) => (v === 128 ? 0 : 255)),
    1
  )
  const out = cloneImg(im)
  putAlpha(out, multiply(alpha, channel(im, 3)))
  return out
}

/** Fill transparent holes enclosed by the logo (for example face cut-outs) with white. */
function fillHoles(lg: Img): Img {
  const a = channel(lg, 3)
  const pad = 4
  const m = newImg(a.width + 2 * pad, a.height + 2 * pad, 1)
  const t = point(a, (v) => (v > 8 ? 255 : 0))
  for (let y = 0; y < a.height; y++) {
    m.data.set(t.data.subarray(y * a.width, (y + 1) * a.width), (y + pad) * m.width + pad)
  }
  floodFill(m, 0, 0, 128)
  const holes = maxFilter(
    crop(
      point(m, (v) => (v === 0 ? 255 : 0)),
      pad,
      pad,
      pad + a.width,
      pad + a.height
    ),
    3
  )
  const bg = newImg(lg.width, lg.height, 4, [255, 255, 255, 255])
  alphaComposite(bg, lg)
  putAlpha(bg, lighter(a, holes))
  return bg
}

export type RGB = readonly [number, number, number]

/**
 * Most common saturated color of the opaque pixels (quantized to 32 levels, then averaged).
 * Neutral (gray, black, white) badges give their mean opaque color.
 */
export function dominantColor(im: Img): RGB {
  const a: RGB[] = []
  for (let i = 0; i < im.data.length; i += 4) {
    if (im.data[i + 3] > 200) {
      a.push([im.data[i], im.data[i + 1], im.data[i + 2]])
    }
  }
  if (!a.length) {
    return [128, 128, 128]
  }
  const mean = (px: RGB[]): RGB =>
    [0, 1, 2].map((c) => pyRound(px.reduce((s, p) => s + p[c], 0) / px.length)) as unknown as RGB
  const sel = a.filter((p) => {
    const mx = Math.max(...p)
    return (mx - Math.min(...p)) / Math.max(mx, 1) > 0.25 && mx > 50
  })
  if (sel.length < 0.02 * a.length) {
    return mean(a)
  }
  const key = (p: RGB): number =>
    Math.floor(p[0] / 32) * 64 + Math.floor(p[1] / 32) * 8 + Math.floor(p[2] / 32)
  const counts = Array.from({ length: 512 }, () => 0)
  sel.forEach((p) => counts[key(p)]++)
  const top = counts.indexOf(Math.max(...counts))
  return mean(sel.filter((p) => key(p) === top))
}

/** A light tint with the hue of rgb: HSV saturation `sat` (less for grayish colors), value `val`. */
export function tint(rgb: RGB, sat: number, val: number): RGB {
  const [r, g, b] = rgb.map((v) => v / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  let h = 0
  let s = 0
  if (mx !== mn) {
    s = (mx - mn) / mx
    const [rc, gc, bc] = [r, g, b].map((v) => (mx - v) / (mx - mn))
    h = r === mx ? bc - gc : g === mx ? 2 + rc - bc : 4 + gc - rc
    h = (((h / 6) % 1) + 1) % 1
  }
  // colorsys.hsv_to_rgb
  const sv = sat * Math.min(1, s / 0.5)
  const i = Math.trunc(h * 6)
  const f = h * 6 - i
  const p = val * (1 - sv)
  const q = val * (1 - sv * f)
  const t = val * (1 - sv * (1 - f))
  const out =
    sv === 0
      ? [val, val, val]
      : [
          [val, t, p],
          [q, val, p],
          [p, val, t],
          [p, q, val],
          [t, p, val],
          [val, p, q]
        ][i % 6]
  return out.map((v) => pyRound(v * 255)) as unknown as RGB
}

/** A badge image, trimmed to its pixels (Python `Logo`). */
export class Logo {
  readonly im: Img
  readonly accent: RGB
  constructor(source: Img) {
    let im = source
    const corners = [
      [0, 0],
      [im.width - 1, 0],
      [0, im.height - 1],
      [im.width - 1, im.height - 1]
    ].map(([x, y]) => im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4))
    if (corners.every((c) => c[3] > 250 && Math.min(c[0], c[1], c[2]) >= 242)) {
      im = keyOutWhite(im)
      const b = bbox(point(channel(im, 3), (v) => (v > 20 ? 255 : 0)))
      if (b) {
        im = crop(im, ...b)
      }
    }
    const b = bbox(im)
    if (!b) {
      throw new Error('The badge image is empty.')
    }
    this.im = crop(im, ...b)
    this.accent = dominantColor(this.im)
  }

  /** The logo at height h, or fitted into a box x box square; holes filled white if asked. */
  sized(h: number, box?: number, holes = true): Img {
    let w: number
    const { width, height } = this.im
    if (box !== undefined) {
      const sc = box / Math.max(width, height)
      w = Math.max(1, pyRound(width * sc))
      h = Math.max(1, pyRound(height * sc))
    } else {
      w = Math.max(1, pyRound((width * h) / height))
    }
    const lg = resize(this.im, w, h)
    return holes ? fillHoles(lg) : lg
  }

  /** The logo at height h with its holes filled white. */
  onWhite(h: number): Img {
    return this.sized(h)
  }

  /** A size x size layer with the logo fitted into fill * size, centered on its bounding box. */
  centered(size: number, fill: number, holes: boolean): Img {
    const lg = this.sized(0, pyRound(size * fill), holes)
    const c = newImg(size, size, 4)
    alphaComposite(c, lg, Math.floor((size - lg.width) / 2), Math.floor((size - lg.height) / 2))
    return c
  }
}
