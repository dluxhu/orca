// Page curl styles: page-curl and page-curl-small (straight fold), gentle-curve,
// rolled-cylinder and round-peel (curved fold).
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, and the constants are
// the defaults of its STYLES table.
import { type Img, alphaComposite, channel, fillPolygon, minFilter, newImg } from './raster'
import { resize } from './resample'
import { type Pt, clip, interp, pyRound, ss_, u8 } from './py'
import type { Logo } from './logo'
import { APPLE_SHADOW, S, masks, shadow } from './normalize'
import { CORNER as C, DD, R2, VV, bez, edgeRing, fromChannels, paper } from './helpers'

const gray = (data: Float64Array): Img => ({
  width: S,
  height: S,
  channels: 1,
  data: Uint8Array.from(data, (v) => u8(v * 255))
})

/** The icon body with the Apple shadow, and the body mask as floats. */
function base(flat: Img): { out: Img; body: Float64Array } {
  const { bodyMask } = masks()
  const out = newImg(S, S, 4)
  alphaComposite(out, shadow(bodyMask, ...APPLE_SHADOW))
  alphaComposite(out, flat)
  return { out, body: Float64Array.from(bodyMask.data, (v) => v / 255) }
}

/** Largest logo (holes white) whose pixels all lie in the region Rn, pushed toward the corner. */
function fitLogo(
  logo: Logo,
  R: Float64Array,
  hmax: number,
  hstep: number,
  tstep: number,
  tmax: number,
  drop: number,
  height?: number
) {
  const Rn = minFilter(gray(R), 27).data.map((v) => (v > 128 ? 1 : 0))
  for (let h = height ?? hmax; h > (height ? height - 1 : 120); h -= hstep) {
    const lg = logo.onWhite(h)
    const la = channel(lg, 3).data
    for (let t = 10; t < tmax; t += tstep) {
      const x = Math.trunc(C - t - lg.width)
      const y = Math.trunc(C - t - lg.height + pyRound(h * drop))
      if (x < 0 || y < 0 || x + lg.width > S || y + lg.height > S) {
        continue
      }
      let fits = true
      for (let j = 0; j < lg.height && fits; j++) {
        for (let i = 0; i < lg.width; i++) {
          if (la[j * lg.width + i] > 20 && !Rn[(y + j) * S + x + i]) {
            fits = false
            break
          }
        }
      }
      if (fits) {
        return { lg, x, y }
      }
    }
  }
  throw new Error('The badge does not fit under the curl.')
}

/** The paper with the logo and the curl shadow `sh`, cut to the revealed region R. */
function revealed(
  a: number,
  R: Float64Array,
  sh: (i: number) => number,
  fit: { lg: Img; x: number; y: number }
): Img {
  const pap = paper(a)
  alphaComposite(pap, fit.lg, fit.x, fit.y)
  for (let i = 0; i < S * S; i++) {
    const k = 1 - sh(i)
    for (let c = 0; c < 3; c++) {
      pap.data[i * 4 + c] = u8(pap.data[i * 4 + c] * k)
    }
    pap.data[i * 4 + 3] = u8(R[i] * 255)
  }
  return pap
}

/** The flap's shadow on the art, outside the flap and inside the body. */
function flapShadow(
  F: Float64Array,
  body: Float64Array,
  sh: readonly [number, number, number, number]
): Img {
  const s = shadow(gray(F), ...sh)
  for (let i = 0; i < S * S; i++) {
    s.data[i * 4 + 3] = u8(s.data[i * 4 + 3] * body[i] * (1 - F[i]))
  }
  return s
}

const PAGE_CURL = { 'page-curl': [600, 0.52], 'page-curl-small': [500, 0.42] } as const

/** v3 straight-fold curl: a triangular flap folded back along a 45-degree crease, edges bowed out. */
export function stPageCurl(flat: Img, logo: Logo, style: keyof typeof PAGE_CURL): Img {
  const [a, k] = PAGE_CURL[style]
  const bow = 0.06
  const { out, body } = base(flat)
  const c0 = 2 * C - a
  const dist = (i: number): number => ((i % S) + Math.floor(i / S) - c0) / R2
  const R = body.map((b, i) => clip(dist(i) + 0.5, 0, 1) * b)
  const Mx = C - a / 2
  const T: Pt = [Mx + k * (C - a - Mx), Mx + k * (C - a - Mx)]
  const ctrl = (P: Pt): Pt => {
    const [dx, dy] = [T[0] - P[0], T[1] - P[1]]
    const L = Math.hypot(dx, dy)
    const [nx, ny] = [-dy / L, dx / L]
    const sgn = nx * (P[0] - P[1]) > 0 ? 1 : -1
    return [(P[0] + T[0]) / 2 + sgn * nx * a * bow, (P[1] + T[1]) / 2 + sgn * ny * a * bow]
  }
  const P1: Pt = [C - a, C]
  const P2: Pt = [C, C - a]
  const pts = [...bez(P1, ctrl(P1), T, 60), ...bez(T, ctrl(P2), P2, 60).slice(1)]
  const SS = 4
  const fm4 = newImg(S * SS, S * SS, 1)
  fillPolygon(
    fm4,
    pts.map(([x, y]) => [x * SS, y * SS])
  )
  const fm = resize(fm4, S, S)
  const F = body.map((b, i) => (fm.data[i] / 255) * b)
  const fit = fitLogo(logo, R, Math.trunc(a * 0.62), 6, 6, 200, 0.04)
  alphaComposite(
    out,
    revealed(a, R, (i) => 0.32 * Math.exp(-Math.max(dist(i), 0) / 38), fit)
  )
  alphaComposite(out, flapShadow(F, body, [0.45, 14, -6, 8]))
  const Dt = (c0 - (T[0] + T[1])) / R2
  const shadeT = [0, 0.08, 0.35, 0.7, 1]
  const shadeV = [196, 226, 252, 240, 222]
  alphaComposite(
    out,
    fromChannels((x, y) => {
      const i = y * S + x
      const shade =
        interp(clip(-dist(i) / Dt, 0, 1), shadeT, shadeV) - 6 * Math.abs((x - y) / (a * R2))
      return [shade, shade, shade + 3, F[i] * 255]
    })
  )
  alphaComposite(out, edgeRing(fm, 0.18, 3))
  return out
}

// length, bend, roll_width, tip_round, and the gray profile across the rolled flap from the fold (0) to its outer edge (1).
const ROLLED = {
  'gentle-curve': [485, 0.16, 0.36, 1, [0, 0.06, 0.3, 0.65, 1], [200, 228, 252, 242, 226]],
  'rolled-cylinder': [
    500,
    0.26,
    0.26,
    0.7,
    [0, 0.05, 0.25, 0.5, 0.72, 0.9, 1],
    [188, 214, 246, 253, 236, 206, 196]
  ],
  'round-peel': [505, 0.2, 0.31, 0.85, [0, 0.05, 0.3, 0.6, 0.85, 1], [192, 222, 250, 246, 228, 214]]
} as const

/** v4 curved-fold curls: the fold bows away from the corner, the page rolls back over the art. */
export function stRolled(flat: Img, logo: Logo, style: keyof typeof ROLLED, height?: number): Img {
  const [a0, s, rollWidth, tipRound, shadeT, shadeV] = ROLLED[style]
  const ve = a0 * (1 - s)
  const { out, body } = base(flat)
  const xy = (i: number): [number, number] => [i % S, Math.floor(i / S)]
  const df = (i: number): number => a0 * (1 - s * (VV(...xy(i)) / ve) ** 2)
  const W = (i: number): number =>
    rollWidth * a0 * Math.sqrt(clip(1 - (VV(...xy(i)) / (ve * 0.995)) ** 2, 0, 1)) ** tipRound
  const R = body.map((b, i) => ss_(df(i) - DD(...xy(i))) * b)
  const F = body.map((b, i) => {
    const [d, w] = [DD(...xy(i)), W(i)]
    return ss_(d - df(i)) * ss_(df(i) + w - d) * (w > 0.5 ? 1 : 0) * b
  })
  const fit = fitLogo(logo, R, Math.trunc(a0 * 0.75), 5, 5, 220, 0.04, height)
  alphaComposite(
    out,
    revealed(a0, R, (i) => 0.3 * Math.exp(-Math.max(df(i) - DD(...xy(i)), 0) / 34), fit)
  )
  alphaComposite(out, flapShadow(F, body, [0.42, 15, -7, 7]))
  alphaComposite(
    out,
    fromChannels((x, y) => {
      const i = y * S + x
      const t = clip((DD(x, y) - df(i)) / Math.max(W(i), 1), 0, 1)
      const sh = interp(t, shadeT, shadeV) - (5 * Math.abs(VV(x, y))) / a0
      return [sh, sh, sh + 3, F[i] * 255]
    })
  )
  alphaComposite(out, edgeRing(gray(F), 0.16, 3))
  return out
}
