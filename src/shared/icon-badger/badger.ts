// Badged macOS app icons: a badge image in the bottom-right corner of an app icon, in the
// styles of dock-icon-badger. See docs/fork/profiles-design.md, section 8.
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
  fillPolygon,
  floodFill,
  gaussianBlur,
  lighter,
  maxFilter,
  minFilter,
  multiply,
  newImg,
  pasteSelfMasked,
  point,
  putAlpha,
  resize,
  subtract,
  BOX
} from './raster'

// ---------------------------------------------------------------- constants (dock_icon_badger.py)
const S = 1024
const BODY = 824
const M = (S - BODY) / 2
const CORNER = M + BODY
const APPLE_SHADOW = [0.3, 12, 0, 10] as const
const GLYPH_FILL = 0.66
const GRID_TOL = 16

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

const SQUIRCLE_D =
  'm 924,355.412 c 0,-9.782 0,-18.35 -0.056,-28.133 -0.049,-8.241 -0.144,-16.48 -0.368,-24.716 -0.484,-17.954 -1.543,-36.061 -4.736,-53.813 -3.238,-18.01 -8.526,-34.77 -16.859,-51.133 a 171.963,171.963 0 0 0 -31.661,-43.559 172.06,172.06 0 0 0 -43.574,-31.64 c -16.381,-8.335 -33.159,-13.621 -51.188,-16.858 -17.755,-3.188 -35.867,-4.245 -53.82,-4.73 -8.243,-0.223 -16.485,-0.317 -24.73,-0.368 -9.788,-0.06 -19.576,-0.055 -29.364,-0.055 L 553.997,100 h -84.999 l -111.637,0.407 c -9.807,0 -19.614,-0.005 -29.421,0.055 -8.262,0.051 -16.52,0.145 -24.778,0.368 -17.995,0.485 -36.148,1.543 -53.945,4.735 -18.053,3.236 -34.857,8.52 -51.259,16.849 a 172.405,172.405 0 0 0 -43.667,31.644 171.994,171.994 0 0 0 -31.718,43.551 c -8.356,16.372 -13.654,33.143 -16.9,51.162 -3.196,17.746 -4.255,35.846 -4.742,53.792 -0.222,8.237 -0.318,16.476 -0.368,24.716 -0.06,9.784 -0.563,21.937 -0.563,31.72 v 195.999 l 0.508,112.429 c 0,9.796 -0.004,19.592 0.055,29.388 0.05,8.252 0.146,16.502 0.369,24.751 0.486,17.976 1.547,36.109 4.746,53.886 3.245,18.032 8.542,34.818 16.891,51.201 a 172.24,172.24 0 0 0 31.722,43.619 172.444,172.444 0 0 0 43.659,31.684 c 16.412,8.346 33.224,13.639 51.288,16.88 17.789,3.193 35.936,4.252 53.924,4.737 8.258,0.223 16.517,0.318 24.779,0.368 9.807,0.059 19.613,0.059 29.42,0.059 h 310.283 c 9.788,0 19.576,0 29.364,-0.059 8.245,-0.05 16.487,-0.145 24.73,-0.368 17.96,-0.486 36.078,-1.546 53.841,-4.741 18.018,-3.241 34.788,-8.532 51.159,-16.873 a 172.004,172.004 0 0 0 43.582,-31.687 172.23,172.23 0 0 0 31.659,-43.612 c 8.337,-16.391 13.625,-33.184 16.865,-51.229 3.19,-17.77 4.248,-35.896 4.733,-53.865 0.223,-8.25 0.318,-16.5 0.367,-24.751 C 924,687.019 924,677.223 924,667.427 Z'

type Pt = [number, number]

// ---------------------------------------------------------------- Python and numpy helpers

/** Python `round()`: half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** numpy `linspace(start, stop, num)`. */
function linspace(start: number, stop: number, num: number): number[] {
  const step = (stop - start) / (num - 1)
  return Array.from({ length: num }, (_, i) => (i === num - 1 ? stop : i * step + start))
}

/** numpy `interp` for increasing xp. */
function interp(x: number, xp: readonly number[], fp: readonly number[]): number {
  if (x <= xp[0]) return fp[0]
  for (let i = 1; i < xp.length; i++) {
    if (x <= xp[i]) {
      return fp[i - 1] + ((x - xp[i - 1]) * (fp[i] - fp[i - 1])) / (xp[i] - xp[i - 1])
    }
  }
  return fp[fp.length - 1]
}

const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const ss_ = (e: number): number => clip(e + 0.5, 0, 1)
/** numpy `astype("uint8")` after a clip to 0..255. */
const u8 = (v: number): number => Math.trunc(clip(v, 0, 255))

function bez(p0: Pt, p1: Pt, p2: Pt, n = 80): Pt[] {
  return linspace(0, 1, n).map((t) => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
  ])
}

// ---------------------------------------------------------------- squircle raster

function svgPathPolys(d: string, steps = 24): Pt[][] {
  const toks = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const polys: Pt[][] = []
  let cur: Pt[] = []
  const num = (): number => Number(toks[i++])
  const ts = linspace(0, 1, steps).slice(1)
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++]
    const rel = cmd === cmd.toLowerCase()
    const c = cmd.toLowerCase()
    if (c === 'z') {
      if (cur.length) polys.push(cur)
      cur = []
      x = sx
      y = sy
      continue
    }
    if (c === 'm') {
      const dx = num()
      const dy = num()
      ;[x, y] = rel ? [x + dx, y + dy] : [dx, dy]
      sx = x
      sy = y
      cur = [[x, y]]
      cmd = rel ? 'l' : 'L'
      continue
    }
    if (c === 'l') {
      const dx = num()
      const dy = num()
      ;[x, y] = rel ? [x + dx, y + dy] : [dx, dy]
      cur.push([x, y])
    } else if (c === 'h') {
      const v = num()
      x = rel ? x + v : v
      cur.push([x, y])
    } else if (c === 'v') {
      const v = num()
      y = rel ? y + v : v
      cur.push([x, y])
    } else if (c === 'c') {
      let p = Array.from({ length: 6 }, num)
      if (rel) p = [p[0] + x, p[1] + y, p[2] + x, p[3] + y, p[4] + x, p[5] + y]
      for (const t of ts) {
        const mt = 1 - t
        cur.push([
          mt ** 3 * x + 3 * mt * mt * t * p[0] + 3 * mt * t * t * p[2] + t ** 3 * p[4],
          mt ** 3 * y + 3 * mt * mt * t * p[1] + 3 * mt * t * t * p[3] + t ** 3 * p[5]
        ])
      }
      ;[x, y] = [p[4], p[5]]
    } else if (c === 'a') {
      const [rx, ry, phi, fa, fs, ex0, ey0] = Array.from({ length: 7 }, num)
      const [ex, ey] = rel ? [ex0 + x, ey0 + y] : [ex0, ey0]
      cur.push(...arc(x, y, rx, ry, (phi * Math.PI) / 180, fa, fs, ex, ey, ts))
      ;[x, y] = [ex, ey]
    } else {
      throw new Error(`unsupported path command ${cmd}`)
    }
  }
  if (cur.length) polys.push(cur)
  return polys
}

function arc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  fa: number,
  fs: number,
  x2: number,
  y2: number,
  ts: number[]
): Pt[] {
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cp * dx + sp * dy
  const y1p = -sp * dx + cp * dy
  const lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const n = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const co =
    Math.sqrt(Math.max(0, n / (rx * rx * y1p * y1p + ry * ry * x1p * x1p))) * (fa === fs ? -1 : 1)
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dt > 0) dt -= 2 * Math.PI
  if (fs && dt < 0) dt += 2 * Math.PI
  return ts.map((t) => {
    const a = t1 + dt * t
    return [
      cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp,
      cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp
    ]
  })
}

let polysCache: Pt[][] | null = null
/** Alpha mask of Apple's squircle. off = margin (in 1024-grid px) around the 824 body. */
export function squircleMask(size: number, off = 0): Img {
  polysCache ??= svgPathPolys(SQUIRCLE_D)
  const ss = 8
  const sc = (size * ss) / (BODY + 2 * off)
  const o = 100 - off
  const m = newImg(size * ss, size * ss, 1)
  for (const p of polysCache) {
    fillPolygon(
      m,
      p.map(([px, py]) => [(px - o) * sc, (py - o) * sc])
    )
  }
  return resize(m, size, size, BOX)
}

// ---------------------------------------------------------------- small helpers

function shadow(a: Img, op: number, sigma: number, dx = 0, dy = 0): Img {
  const sh = newImg(a.width, a.height, 4)
  putAlpha(sh, point(a, (v) => v * op))
  const o = newImg(a.width, a.height, 4)
  alphaComposite(o, gaussianBlur(sh, sigma), dx, dy)
  return o
}

function edgeRing(mask: Img, op: number, w = 5): Img {
  const e = subtract(mask, minFilter(mask, w))
  const r = newImg(mask.width, mask.height, 4)
  putAlpha(r, point(e, (v) => v * op))
  return r
}

/** An RGBA image from per-pixel float channels, like `Image.fromarray(np.dstack(...).astype("uint8"))`. */
function fromChannels(fn: (x: number, y: number) => [number, number, number, number]): Img {
  const out = newImg(S, S, 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = fn(x, y)
      const i = (y * S + x) * 4
      for (let c = 0; c < 4; c++) out.data[i + c] = u8(v[c])
    }
  }
  return out
}

// ---------------------------------------------------------------- badge image (logo)

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
    if (m.data[y * m.width + x] === 255) floodFill(m, x, y, 128)
  }
  const alpha = gaussianBlur(point(m, (v) => (v === 128 ? 0 : 255)), 1.0)
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
    crop(point(m, (v) => (v === 0 ? 255 : 0)), pad, pad, pad + a.width, pad + a.height),
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
      if (b) im = crop(im, ...b)
    }
    const b = bbox(im)
    if (!b) throw new Error('The badge image is empty.')
    this.im = crop(im, ...b)
  }

  /** The logo at height h with its holes filled white. */
  onWhite(h: number): Img {
    const w = Math.max(1, pyRound((this.im.width * h) / this.im.height))
    return fillHoles(resize(this.im, w, h))
  }
}

// ---------------------------------------------------------------- icon normalization

let masksCache: { mask: Img; bodyMask: Img } | null = null
function masks(): { mask: Img; bodyMask: Img } {
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
    for (let x = x0; x <= x1; x++) if (a[y * im.width + x] > 128) filled++
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
      return { kind: 'shaped (refit)', ...appleIcon(resize(crop(im, x0, y0, x1 + 1, y1 + 1), BODY, BODY)) }
    }
    const big = im.width !== S ? resize(im, S, S) : cloneImg(im)
    const flat = cloneImg(big)
    putAlpha(flat, multiply(channel(big, 3), masks().bodyMask))
    return { kind: 'macOS-shaped', icon: big, flat }
  }
  const b = bbox(im)
  if (!b) throw new Error('The app icon is empty.')
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
  const poly = [
    ...arcPts,
    ...bez(arcPts[arcPts.length - 1], cl, T).slice(1),
    ...bez(T, cu, arcPts[0]).slice(1, -1)
  ]
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
      if (x < 0 || y < 0 || x + lg.width > S || y + lg.height > S) continue
      let outside = false
      let hidden = 0
      for (let j = 0; j < lg.height && !outside; j++) {
        for (let i = 0; i < lg.width; i++) {
          if (!la[j * lg.width + i]) continue
          const g = (y + j) * S + x + i
          if (!bodyIn[g]) {
            outside = true
            break
          }
          if (!(R[g] > 0.5)) hidden++
        }
      }
      if (outside) continue
      const c = hidden / tot
      if (c <= OVERLAP[1]) {
        if (c >= OVERLAP[0]) best = { lg, x, y, h, c }
        else fallback ??= { lg, x, y, h, c }
        break
      }
    }
    if (best) break
  }
  const chosen = best ?? fallback
  if (!chosen) throw new Error('The badge does not fit under the curl.')
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
      for (let c = 0; c < 3; c++) pap.data[i * 4 + c] = u8(pap.data[i * 4 + c] * (1 - sh))
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
