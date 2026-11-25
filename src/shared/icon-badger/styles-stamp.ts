// The sticker and stamp badge styles: rotated paper.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, and the constants are
// the defaults of its STYLES table.
import {
  type Img,
  alphaComposite,
  bbox,
  channel,
  maxFilter,
  newImg,
  point,
  putAlpha
} from './raster'
import { gaussianBlur, resize } from './resample'
import { pyRound } from './py'
import type { Logo, RGB } from './logo'
import { B, CORNER, edgeRing } from './helpers'
import { fillEllipse, outlineRect, rotate } from './draw'
import { at, putLayer, solid } from './styles-tile'

const STAMP_FIT_ANGLE = 6
const footprint = (deg: number): number =>
  Math.abs(Math.cos((deg * Math.PI) / 180)) + Math.abs(Math.sin((deg * Math.PI) / 180))

/** Postage stamp: perforated cream paper, a frame in the badge's color, rotated. */
export function stStamp(icon: Img, logo: Logo): Img {
  const rot = -6
  const W = pyRound(B * Math.min(1, footprint(STAMP_FIT_ANGLE) / footprint(rot)))
  const SS = 3
  const m = newImg(W * SS, W * SS, 1, [255])
  const r = 11 * SS
  const step = 30 * SS
  const n = pyRound((W * SS) / step)
  for (let i = 0; i <= n; i++) {
    const cx = (i * (W * SS)) / n
    for (const cy of [0, W * SS]) {
      fillEllipse(m, [cx - r, cy - r, cx + r, cy + r], 0)
    }
    for (const cxx of [0, W * SS]) {
      fillEllipse(m, [cxx - r, cx - r, cxx + r, cx + r], 0)
    }
  }
  const mask = resize(m, W, W)
  const t = solid(W, [255, 253, 248])
  const ins = 26
  outlineRect(t, [ins, ins, W - ins - 1, W - ins - 1], [...logo.accent, 255], 4)
  alphaComposite(t, logo.centered(W, 0.74, true))
  putAlpha(t, mask)
  alphaComposite(t, edgeRing(mask, 0.12, 3))
  const rt = rotate(t, -rot)
  return putLayer(icon, at(rt, CORNER - rt.width + 34, CORNER - rt.height + 34), [0.38, 9, 2, 7])
}

/** The logo fitted into box, on a backing traced around its alpha, rotated by rot degrees clockwise. */
export function dieCut(
  logo: Logo,
  box: number,
  holes: boolean,
  border: number,
  rot: number,
  backing: RGB
): Img {
  const lg = logo.sized(0, box, holes)
  const pad = border + 8
  const c = newImg(lg.width + 2 * pad, lg.height + 2 * pad, 4)
  alphaComposite(c, lg, pad, pad)
  const a = gaussianBlur(
    point(gaussianBlur(maxFilter(channel(c, 3), 2 * border + 1), border * 0.6), (v) =>
      v > 110 ? 255 : 0
    ),
    1
  )
  const s = newImg(c.width, c.height, 4, [...backing, 255])
  putAlpha(s, a)
  alphaComposite(s, edgeRing(a, 0.1, 3))
  alphaComposite(s, c)
  return rotate(s, -rot)
}

/**
 * Die-cut sticker: a white backing traced around the badge's own shape, rotated 9 degrees
 * clockwise. The search scales the logo until the rotated sticker is 1.024 x the badge size.
 */
export function stSticker(icon: Img, logo: Logo): Img {
  const border = 18
  const target = 1.024 * B
  let box = 0.898 * B
  let st = newImg(1, 1, 4)
  let bb = [0, 0, 0, 0]
  let D = 0
  for (let i = 0; i < 6; i++) {
    st = dieCut(logo, pyRound(box), false, border, 9, [255, 255, 255])
    bb = bbox(point(channel(st, 3), (v) => (v > 8 ? 255 : 0)))!
    D = Math.max(bb[2] - bb[0], bb[3] - bb[1])
    if (Math.abs(D - target) <= 2) {
      break
    }
    box *= (target - 2 * border) / Math.max(1, D - 2 * border)
  }
  // The search did not converge: scale the last sticker to the target.
  if (Math.abs(D - target) > 2) {
    const f = target / D
    st = resize(st, Math.max(1, pyRound(st.width * f)), Math.max(1, pyRound(st.height * f)))
    bb = bb.map((v) => pyRound(v * f))
  }
  return putLayer(icon, at(st, CORNER + 6 - bb[2], CORNER - 7 - bb[3]), [0.4, 8, 2, 7])
}
