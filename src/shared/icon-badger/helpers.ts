// Helpers that more than one style uses: the corner grid, the curve, the edge ring, the paper.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names.
import { type Img, minFilter, newImg, point, putAlpha, subtract } from './raster'
import { type Pt, clip, linspace, u8 } from './py'
import { BODY } from './squircle'
import { M, S } from './normalize'

/** The bottom-right corner of the body (924, 924). The badges align to it. */
export const CORNER = M + BODY
/** The badge size: 50 % of the body. */
export const B = BODY / 2

export function bez(p0: Pt, p1: Pt, p2: Pt, n = 80): Pt[] {
  return linspace(0, 1, n).map((t) => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
  ])
}

export function edgeRing(mask: Img, op: number, w = 5): Img {
  const e = subtract(mask, minFilter(mask, w))
  const r = newImg(mask.width, mask.height, 4)
  putAlpha(
    r,
    point(e, (v) => v * op)
  )
  return r
}

/** An RGBA image from per-pixel float channels, like `Image.fromarray(np.dstack(...).astype("uint8"))`. */
export function fromChannels(
  fn: (x: number, y: number) => [number, number, number, number],
  width = S,
  height = S
): Img {
  const out = newImg(width, height, 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fn(x, y)
      const i = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        out.data[i + c] = u8(v[c])
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- the corner grid (Python `grid`)

export const R2 = Math.SQRT2
const C = CORNER
/** Distance from the corner along the diagonal. */
export const DD = (x: number, y: number): number => (C - x + (C - y)) / R2
/** Distance across the diagonal. */
export const VV = (x: number, y: number): number => (x - y) / R2

/** Python `_paper`: the paper under a curl, a little darker toward the bottom. */
export function paper(L: number, top = 250, fall = 6): Img {
  return fromChannels((_, y) => {
    const g = top - fall * clip((y - (C - L)) / L, 0, 1)
    return [g, g, g + 2, 255]
  })
}
