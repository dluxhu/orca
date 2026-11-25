// App icon normalization: any app icon to the macOS grid (squircle body, Apple shadow).
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names.
import {
  type Img,
  alphaComposite,
  bbox,
  channel,
  cloneImg,
  crop,
  multiply,
  newImg,
  pasteSelfMasked,
  point,
  putAlpha
} from './raster'
import { gaussianBlur, resize } from './resample'
import { BODY, squircleMask } from './squircle'

export const S = 1024
export const M = (S - BODY) / 2
export const APPLE_SHADOW = [0.3, 12, 0, 10] as const
const GLYPH_FILL = 0.66
const GRID_TOL = 16

export function shadow(a: Img, op: number, sigma: number, dx = 0, dy = 0): Img {
  const sh = newImg(a.width, a.height, 4)
  putAlpha(
    sh,
    point(a, (v) => v * op)
  )
  const o = newImg(a.width, a.height, 4)
  alphaComposite(o, gaussianBlur(sh, sigma), dx, dy)
  return o
}

// ---------------------------------------------------------------- icon normalization

let masksCache: { mask: Img; bodyMask: Img } | null = null
export function masks(): { mask: Img; bodyMask: Img } {
  masksCache ??= { mask: squircleMask(BODY), bodyMask: squircleMask(S, 100) }
  return masksCache
}

/** 824x824 art to the 1024 canvas: squircle-masked body and Apple shadow. */
function appleIcon(body0: Img): { icon: Img; flat: Img } {
  const body = cloneImg(body0)
  putAlpha(body, multiply(channel(body, 3), masks().mask))
  const c = newImg(S, S, 4)
  pasteSelfMasked(c, body, M, M)
  const o = shadow(channel(c, 3), ...APPLE_SHADOW)
  alphaComposite(o, c)
  return { icon: o, flat: c }
}

export type NormalizedIcon = { kind: string; icon: Img; flat: Img }

/** Puts an app icon on the macOS grid. Returns the icon with shadow and the flat body. */
export function normalizeIcon(im: Img): NormalizedIcon {
  const a = channel(im, 3).data
  if (a.every((v) => v > 250)) {
    return { kind: 'full-bleed', ...appleIcon(resize(im, BODY, BODY)) }
  }
  let x0 = im.width
  let y0 = im.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      if (a[y * im.width + x] > 250) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
  }
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  let filled = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (a[y * im.width + x] > 128) {
        filled++
      }
    }
  }
  const fill = filled / Math.max(1, squircleMask(Math.max(w, h)).data.filter((v) => v > 128).length)
  if (x1 >= 0 && Math.abs(w - h) <= 0.03 * Math.max(w, h) && fill > 0.93) {
    const sc = S / im.width
    const onGrid = [
      [x0, M],
      [y0, M],
      [x1, S - M - 1],
      [y1, S - M - 1]
    ].every(([v, t]) => Math.abs(v * sc - t) <= GRID_TOL)
    if (!onGrid) {
      return {
        kind: 'shaped (refit)',
        ...appleIcon(resize(crop(im, x0, y0, x1 + 1, y1 + 1), BODY, BODY))
      }
    }
    const big = im.width !== S ? resize(im, S, S) : cloneImg(im)
    const flat = cloneImg(big)
    putAlpha(flat, multiply(channel(big, 3), masks().bodyMask))
    return { kind: 'macOS-shaped', icon: big, flat }
  }
  const b = bbox(im)
  if (!b) {
    throw new Error('The app icon is empty.')
  }
  let g = crop(im, ...b)
  const gw = Math.trunc(BODY * GLYPH_FILL)
  g =
    g.width >= g.height
      ? resize(g, gw, Math.trunc((g.height * gw) / g.width))
      : resize(g, Math.trunc((g.width * gw) / g.height), gw)
  const p = newImg(BODY, BODY, 4, [255, 255, 255, 255])
  alphaComposite(p, g, Math.floor((BODY - g.width) / 2), Math.floor((BODY - g.height) / 2))
  return { kind: 'glyph on white', ...appleIcon(p) }
}
