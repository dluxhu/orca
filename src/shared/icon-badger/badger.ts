// Badged macOS app icons: a badge image in the bottom-right corner of an app icon, in the
// styles of dock-icon-badger. See docs/fork/profiles-design.md, section 8.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, so a diff against
// dock_icon_badger.py stays easy.
import {
  type Img,
  alphaComposite,
  channel,
  fillPolygon,
  minFilter,
  newImg,
  point,
  putAlpha,
  subtract
} from './raster'
import { resize } from './resample'
import { type Pt, clip, interp, linspace, pyRound, ss_, u8 } from './py'
import { BODY } from './squircle'
import { Logo } from './logo'
import { APPLE_SHADOW, M, S, masks, normalizeIcon, shadow } from './normalize'

// ---------------------------------------------------------------- constants (dock_icon_badger.py)
const CORNER = M + BODY

export const ARC_MID = 0.522
const FLAP_TIP = [0.974, -0.068] as const
const FLAP_CTRL_UPPER = [0.821, 0.175] as const
const FLAP_CTRL_LOWER = [0.703, -0.282] as const
const FLAP_BASE = [0.57, -0.59] as const
const PAPER_TOP = 251
const PAPER_FALL = 5
const CURL_SHADOW = [0.42, 55, 0.18, 12] as const
const CURL_SHADOW_ENDS = 0.35
const FLAP_SHADE_T = [0, 0.06, 0.25, 0.6, 1]
const FLAP_SHADE_V = [192, 222, 240, 250, 253]
const FLAP_SHADE_TOPRIGHT = 32
const FLAP_DROP = [0.3, 7, -3, 5] as const
const FLAP_EDGE = [0.12, 3] as const
const OVERLAP = [0.08, 0.16] as const
const LOGO_MAX = 0.62
const LOGO_BODY_MARGIN = 41

function bez(p0: Pt, p1: Pt, p2: Pt, n = 80): Pt[] {
  return linspace(0, 1, n).map((t) => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
  ])
}

function edgeRing(mask: Img, op: number, w = 5): Img {
  const e = subtract(mask, minFilter(mask, w))
  const r = newImg(mask.width, mask.height, 4)
  putAlpha(
    r,
    point(e, (v) => v * op)
  )
  return r
}

/** An RGBA image from per-pixel float channels, like `Image.fromarray(np.dstack(...).astype("uint8"))`. */
function fromChannels(fn: (x: number, y: number) => [number, number, number, number]): Img {
  const out = newImg(S, S, 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = fn(x, y)
      const i = (y * S + x) * 4
      for (let c = 0; c < 4; c++) {
        out.data[i + c] = u8(v[c])
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- page curls

const R2 = Math.SQRT2
const C = CORNER
const DD = (x: number, y: number): number => (C - x + (C - y)) / R2
const VV = (x: number, y: number): number => (x - y) / R2

function paper(L: number, top: number, fall: number): Img {
  return fromChannels((_, y) => {
    const g = top - fall * clip((y - (C - L)) / L, 0, 1)
    return [g, g, g + 2, 255]
  })
}

/**
 * ref-match: concave page edge (circular arc) and teardrop flap; the badge tucked under the curl.
 * `height` fixes the badge height instead of the search. Returns the image, the badge height and
 * the part of the badge under the curl.
 */
export function pageCurl(
  flat: Img,
  logo: Logo,
  L = 700,
  k = 0.78,
  drop = 0.04,
  height?: number
): { img: Img; h: number; c: number } {
  const { bodyMask } = masks()
  const body = (i: number): number => bodyMask.data[i] / 255
  const xy = (dd: number, vv: number): Pt => [C - (dd - vv) / R2, C - (dd + vv) / R2]
  const de = L / R2
  const dc = ARC_MID * L
  const sag = de - dc
  const r = (de ** 2 + sag ** 2) / (2 * sag)
  const arcDD = (vv: number): number => dc + r - Math.sqrt(Math.max(r * r - vv * vv, 0))
  const distc = new Float64Array(S * S)
  const R = new Float64Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      distc[i] = Math.sqrt((DD(x, y) - (dc + r)) ** 2 + VV(x, y) ** 2)
      R[i] = ss_(distc[i] - r) * ss_(de + 40 - DD(x, y)) * body(i)
    }
  }
  const sc = (p: readonly [number, number]): Pt => [dc + k * (p[0] * L - dc), k * p[1] * L]
  const T = sc(FLAP_TIP)
  const cu = sc(FLAP_CTRL_UPPER)
  const cl = sc(FLAP_CTRL_LOWER)
  const vb1 = FLAP_BASE[0] * L
  const vb2 = FLAP_BASE[1] * L
  const arcPts = linspace(vb1, vb2, 120).map((v): Pt => [arcDD(v), v])
  const [arcEnd] = arcPts.slice(-1)
  const poly = [...arcPts, ...bez(arcEnd, cl, T).slice(1), ...bez(T, cu, arcPts[0]).slice(1, -1)]
  const SS = 4
  const fm4 = newImg(S * SS, S * SS, 1)
  fillPolygon(
    fm4,
    poly.map(([d, v]) => {
      const [px, py] = xy(d, v)
      return [px * SS, py * SS]
    })
  )
  const fm = resize(fm4, S, S)
  const F = new Float64Array(S * S).map((_, i) => (fm.data[i] / 255) * body(i))

  const out = newImg(S, S, 4)
  alphaComposite(out, shadow(bodyMask, ...APPLE_SHADOW))
  alphaComposite(out, flat)

  // paper and logo
  const pap = paper(L, PAPER_TOP, PAPER_FALL)
  const bodyIn = minFilter(bodyMask, LOGO_BODY_MARGIN).data.map((v) => (v > 128 ? 1 : 0))
  type Fit = { lg: Img; x: number; y: number; h: number; c: number }
  let best: Fit | null = null
  let fallback: Fit | null = null
  for (let h = height ?? Math.trunc(L * LOGO_MAX); h >= (height ?? 151); h -= 4) {
    const lg = logo.onWhite(h)
    const la = channel(lg, 3).data.map((v) => (v > 20 ? 1 : 0))
    const tot = la.reduce((s, v) => s + v, 0)
    for (let t = 10; t < 300; t += 4) {
      const x = Math.trunc(C - t - lg.width)
      const y = Math.trunc(C - t - lg.height + pyRound(h * drop))
      if (x < 0 || y < 0 || x + lg.width > S || y + lg.height > S) {
        continue
      }
      let outside = false
      let hidden = 0
      for (let j = 0; j < lg.height && !outside; j++) {
        for (let i = 0; i < lg.width; i++) {
          if (!la[j * lg.width + i]) {
            continue
          }
          const g = (y + j) * S + x + i
          if (!bodyIn[g]) {
            outside = true
            break
          }
          if (!(R[g] > 0.5)) {
            hidden++
          }
        }
      }
      if (outside) {
        continue
      }
      const c = hidden / tot
      if (c <= OVERLAP[1]) {
        if (c >= OVERLAP[0]) {
          best = { lg, x, y, h, c }
        } else {
          fallback ??= { lg, x, y, h, c }
        }
        break
      }
    }
    if (best) {
      break
    }
  }
  const chosen = best ?? fallback
  if (!chosen) {
    throw new Error('The badge does not fit under the curl.')
  }
  alphaComposite(pap, chosen.lg, chosen.x, chosen.y)

  // curl shadow on the paper, along the arc
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const da = Math.max(distc[i] - r, 0)
      const along = clip(1 - (VV(x, y) / (de * 1.05)) ** 2, 0, 1)
      const sh =
        (CURL_SHADOW[0] * Math.exp(-da / CURL_SHADOW[1]) +
          CURL_SHADOW[2] * Math.exp(-da / CURL_SHADOW[3])) *
        (CURL_SHADOW_ENDS + (1 - CURL_SHADOW_ENDS) * along)
      for (let c = 0; c < 3; c++) {
        pap.data[i * 4 + c] = u8(pap.data[i * 4 + c] * (1 - sh))
      }
      pap.data[i * 4 + 3] = u8(R[i] * 255)
    }
  }
  alphaComposite(out, pap)

  // faint flap shadow on the art
  const fl: Img = { width: S, height: S, channels: 1, data: Uint8Array.from(F, (v) => u8(v * 255)) }
  const s1 = shadow(fl, ...FLAP_DROP)
  for (let i = 0; i < S * S; i++) {
    s1.data[i * 4 + 3] = u8(s1.data[i * 4 + 3] * (1 - R[i]) * body(i))
  }
  alphaComposite(out, s1)

  // flap shading
  const tDen = Math.max(T[0] - dc, 1)
  alphaComposite(
    out,
    fromChannels((x, y) => {
      const i = y * S + x
      const t = clip((DD(x, y) - arcDD(VV(x, y))) / tDen, 0, 1)
      const u = clip((VV(x, y) - vb2) / (vb1 - vb2), 0, 1)
      const shade = interp(t, FLAP_SHADE_T, FLAP_SHADE_V) - FLAP_SHADE_TOPRIGHT * u * (1 - t) ** 1.5
      return [shade, shade, shade + 3, F[i] * 255]
    })
  )
  alphaComposite(out, edgeRing(fl, ...FLAP_EDGE))
  return { img: out, h: chosen.h, c: chosen.c }
}

// ---------------------------------------------------------------- styles

export const ICON_STYLES = ['ref-match', 'ref-match-bigger'] as const
export type IconStyle = (typeof ICON_STYLES)[number]

const CURLS: Record<IconStyle, [number, number]> = {
  'ref-match': [700, 0.78],
  'ref-match-bigger': [760, 0.84]
}

/** One badged icon, 1024 x 1024 RGBA. `app` is the app icon, `badge` the badge image. */
export function renderBadgedIcon(
  app: Img,
  badge: Img,
  style: IconStyle = 'ref-match',
  badgeHeight?: number
): Img {
  const [L, k] = CURLS[style]
  return pageCurl(normalizeIcon(app).flat, new Logo(badge), L, k, 0.04, badgeHeight).img
}
