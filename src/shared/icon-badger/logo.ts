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

/** A badge image, trimmed to its pixels (Python `Logo`). */
export class Logo {
  readonly im: Img
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
  }

  /** The logo at height h with its holes filled white. */
  onWhite(h: number): Img {
    const w = Math.max(1, pyRound((this.im.width * h) / this.im.height))
    return fillHoles(resize(this.im, w, h))
  }
}
