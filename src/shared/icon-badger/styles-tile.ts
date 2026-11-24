// Badge styles on a tile: white-tile, tint-tile, frosted, liquid-glass, round.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, and the constants are
// the defaults of its STYLES table.
import {
  type Img,
  alphaComposite,
  channel,
  cloneImg,
  crop,
  minFilter,
  newImg,
  putAlpha,
  subtract
} from './raster'
import { gaussianBlur, resize } from './resample'
import { clip, linspace } from './py'
import { squircleMask } from './squircle'
import { type Logo, type RGB, tint } from './logo'
import { S, shadow } from './normalize'
import { B, CORNER, edgeRing, fromChannels } from './helpers'
import { fillEllipse } from './draw'

export type Shadow = readonly [number, number, number, number]
const WHITE: RGB = [255, 255, 255]

const sqCache = new Map<number, Img>()
function sq(size: number): Img {
  if (!sqCache.has(size)) {
    sqCache.set(size, squircleMask(size))
  }
  return sqCache.get(size)!
}

export function putLayer(icon: Img, lay: Img, sh: Shadow): Img {
  const o = cloneImg(icon)
  alphaComposite(o, shadow(channel(lay, 3), sh[0], sh[1], Math.trunc(sh[2]), Math.trunc(sh[3])))
  alphaComposite(o, lay)
  return o
}

export function at(tile: Img, x: number, y: number): Img {
  const lay = newImg(S, S, 4)
  alphaComposite(lay, tile, Math.trunc(x), Math.trunc(y))
  return lay
}

/** A solid RGBA tile, opaque unless `alpha` says otherwise. */
export const solid = (size: number, rgb: RGB, alpha = 255): Img =>
  newImg(size, size, 4, [...rgb, alpha])

/** The edge ring of the mask on the tile, then the mask as its alpha, then the layer at the corner. */
function finish(icon: Img, t: Img, mask: Img, ring: number, sh: Shadow, off = 0): Img {
  alphaComposite(t, edgeRing(mask, ring))
  putAlpha(t, mask)
  return putLayer(icon, at(t, CORNER - t.width + off, CORNER - t.height + off), sh)
}

function grad(top: RGB, bot: RGB, size: number): Img {
  const t = linspace(0, 1, size)
  return fromChannels(
    (_, y) => [0, 1, 2].map((c) => top[c] * (1 - t[y]) + bot[c] * t[y]).concat(255) as never,
    size,
    size
  )
}

function backdrop(icon: Img, Bs: number, blur: number, pad: number): Img {
  const x0 = CORNER - Bs
  const c = crop(icon, x0 - pad, x0 - pad, x0 + Bs + pad, x0 + Bs + pad)
  return crop(gaussianBlur(c, blur), pad, pad, pad + Bs, pad + Bs)
}

export function stWhiteTile(icon: Img, logo: Logo): Img {
  const t = solid(B, WHITE)
  alphaComposite(t, logo.centered(B, 0.9, true))
  return finish(icon, t, sq(B), 0.1, [0.35, 9, 0, 6])
}

export function stTintTile(icon: Img, logo: Logo): Img {
  const t = grad(tint(logo.accent, 0.047, 0.996), tint(logo.accent, 0.159, 0.961), B)
  alphaComposite(t, logo.centered(B, 0.74, false))
  return finish(icon, t, sq(B), 0.12, [0.35, 9, 0, 6])
}

export function stFrosted(icon: Img, logo: Logo): Img {
  const t = backdrop(icon, B, 22, 40)
  alphaComposite(t, solid(B, WHITE, Math.trunc(255 * 0.66)))
  alphaComposite(t, logo.centered(B, 0.86, true))
  return finish(icon, t, sq(B), 0.12, [0.25, 10, 0, 6])
}

export function stLiquidGlass(icon: Img, logo: Logo): Img {
  const bm = sq(B)
  const yy = linspace(0, 1, B)
  const t = backdrop(icon, B, 28, 48)
  alphaComposite(t, solid(B, WHITE, Math.trunc(255 * 0.72)))
  const spec = (y: number): number => Math.max(0.55 * (1 - yy[y] / 0.45), 0) * 255
  alphaComposite(
    t,
    fromChannels((_, y) => [255, 255, 255, spec(y)], B, B)
  )
  alphaComposite(t, logo.centered(B, 0.86, true))
  // The rim: bright at the top, dark at the bottom.
  const e = subtract(bm, minFilter(bm, 7)).data
  const rim = (rgb: number, f: (y: number) => number, k: number): Img =>
    fromChannels((x, y) => [rgb, rgb, rgb, (e[y * B + x] / 255) * f(yy[y]) * k], B, B)
  alphaComposite(
    t,
    rim(0, (y) => clip((y - 0.5) * 2, 0, 1), 45)
  )
  alphaComposite(
    t,
    rim(255, (y) => clip(1 - y * 1.6, 0, 1), 230)
  )
  alphaComposite(t, edgeRing(bm, 0.1, 3))
  putAlpha(t, bm)
  return putLayer(icon, at(t, CORNER - B, CORNER - B), [0.3, 12, 0, 8])
}

export function stRound(icon: Img, logo: Logo): Img {
  const SS = 4
  const big = newImg(B * SS, B * SS, 1)
  fillEllipse(big, [0, 0, B * SS - 1, B * SS - 1], 255)
  const t = solid(B, WHITE)
  alphaComposite(t, logo.centered(B, 0.7, true))
  return finish(icon, t, resize(big, B, B), 0.12, [0.35, 9, 0, 6], 18)
}
