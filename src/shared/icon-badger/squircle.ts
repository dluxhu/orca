// Apple's squircle: the SVG path of the macOS icon body, filled with 8x supersampling.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo. The functions keep the Python names, so a diff against
// dock_icon_badger.py stays easy.
import { type Img, fillPolygon, newImg } from './raster'
import { BOX, resize } from './resample'
import { type Pt, linspace } from './py'

/** The icon body on the 1024 px grid. */
export const BODY = 824

const SQUIRCLE_D =
  'm 924,355.412 c 0,-9.782 0,-18.35 -0.056,-28.133 -0.049,-8.241 -0.144,-16.48 -0.368,-24.716 -0.484,-17.954 -1.543,-36.061 -4.736,-53.813 -3.238,-18.01 -8.526,-34.77 -16.859,-51.133 a 171.963,171.963 0 0 0 -31.661,-43.559 172.06,172.06 0 0 0 -43.574,-31.64 c -16.381,-8.335 -33.159,-13.621 -51.188,-16.858 -17.755,-3.188 -35.867,-4.245 -53.82,-4.73 -8.243,-0.223 -16.485,-0.317 -24.73,-0.368 -9.788,-0.06 -19.576,-0.055 -29.364,-0.055 L 553.997,100 h -84.999 l -111.637,0.407 c -9.807,0 -19.614,-0.005 -29.421,0.055 -8.262,0.051 -16.52,0.145 -24.778,0.368 -17.995,0.485 -36.148,1.543 -53.945,4.735 -18.053,3.236 -34.857,8.52 -51.259,16.849 a 172.405,172.405 0 0 0 -43.667,31.644 171.994,171.994 0 0 0 -31.718,43.551 c -8.356,16.372 -13.654,33.143 -16.9,51.162 -3.196,17.746 -4.255,35.846 -4.742,53.792 -0.222,8.237 -0.318,16.476 -0.368,24.716 -0.06,9.784 -0.563,21.937 -0.563,31.72 v 195.999 l 0.508,112.429 c 0,9.796 -0.004,19.592 0.055,29.388 0.05,8.252 0.146,16.502 0.369,24.751 0.486,17.976 1.547,36.109 4.746,53.886 3.245,18.032 8.542,34.818 16.891,51.201 a 172.24,172.24 0 0 0 31.722,43.619 172.444,172.444 0 0 0 43.659,31.684 c 16.412,8.346 33.224,13.639 51.288,16.88 17.789,3.193 35.936,4.252 53.924,4.737 8.258,0.223 16.517,0.318 24.779,0.368 9.807,0.059 19.613,0.059 29.42,0.059 h 310.283 c 9.788,0 19.576,0 29.364,-0.059 8.245,-0.05 16.487,-0.145 24.73,-0.368 17.96,-0.486 36.078,-1.546 53.841,-4.741 18.018,-3.241 34.788,-8.532 51.159,-16.873 a 172.004,172.004 0 0 0 43.582,-31.687 172.23,172.23 0 0 0 31.659,-43.612 c 8.337,-16.391 13.625,-33.184 16.865,-51.229 3.19,-17.77 4.248,-35.896 4.733,-53.865 0.223,-8.25 0.318,-16.5 0.367,-24.751 C 924,687.019 924,677.223 924,667.427 Z'

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
    if (/[A-Za-z]/.test(toks[i])) {
      cmd = toks[i++]
    }
    const rel = cmd === cmd.toLowerCase()
    const c = cmd.toLowerCase()
    if (c === 'z') {
      if (cur.length) {
        polys.push(cur)
      }
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
      if (rel) {
        p = [p[0] + x, p[1] + y, p[2] + x, p[3] + y, p[4] + x, p[5] + y]
      }
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
  if (cur.length) {
    polys.push(cur)
  }
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
  if (!fs && dt > 0) {
    dt -= 2 * Math.PI
  }
  if (fs && dt < 0) {
    dt += 2 * Math.PI
  }
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
