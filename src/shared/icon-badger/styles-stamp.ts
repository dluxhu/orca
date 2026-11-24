// The stamp badge style: perforated paper, rotated.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, and the constants are
// the defaults of its STYLES table.
import { type Img, alphaComposite, newImg, putAlpha } from './raster'
import { resize } from './resample'
import { pyRound } from './py'
import type { Logo } from './logo'
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
