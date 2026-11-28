// Pillow's ellipse fill, rectangle outline and bicubic rotation.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo.
//
// The algorithms are ported from Pillow (https://python-pillow.org), MIT-CMU License: see
// LICENSE-Pillow in this folder.
import { type Img, newImg } from './raster'
import { premultiply, unpremultiply } from './resample'

/** Pillow `hline` on an "L" image: x0..x1 inclusive, clipped. */
function hline(img: Img, x0: number, y: number, x1: number, value: number): void {
  if (y < 0 || y >= img.height || x0 >= img.width || x1 < 0) {
    return
  }
  img.data.fill(
    value,
    y * img.width + Math.max(0, x0),
    y * img.width + Math.min(x1, img.width - 1) + 1
  )
}

/**
 * ImageDraw.ellipse(xy, fill=value) on an "L" image (Pillow `ellipseNew` with fill). The
 * quarter walk works in doubled coordinates and picks the points nearest to the curve.
 */
export function fillEllipse(img: Img, xy: readonly number[], value: number): void {
  const [x0, y0, x1, y1] = xy.map(Math.trunc)
  const a = x1 - x0
  const b = y1 - y0
  if (a < 0 || b < 0) {
    return
  }
  const delta = (x: number, y: number): number =>
    Math.abs(a * a * y * y + b * b * x * x - a * a * b * b)
  // The first point of each row has the largest x.
  const rows = new Map<number, number>()
  let cx = a
  let cy = b % 2
  for (;;) {
    if (!rows.has(cy)) {
      rows.set(cy, cx)
    }
    if (cx === a % 2 && cy === b) {
      break
    }
    let [nx, ny] = [cx, cy + 2]
    if (nx > 1) {
      let d = delta(nx, ny)
      if (d > delta(cx - 2, cy + 2)) {
        ;[nx, ny, d] = [cx - 2, cy + 2, delta(cx - 2, cy + 2)]
      }
      if (d > delta(cx - 2, cy)) {
        ;[nx, ny] = [cx - 2, cy]
      }
    }
    ;[cx, cy] = [nx, ny]
  }
  for (const [y, r] of rows) {
    const l = x0 + Math.trunc((a - r) / 2)
    const h = x0 + Math.trunc((a + r) / 2)
    hline(img, l, y0 + Math.trunc((b - y) / 2), h, value)
    hline(img, l, y0 + Math.trunc((b + y) / 2), h, value)
  }
}

/** ImageDraw.rectangle(xy, outline=color, width) on an RGBA image: a frame inside the box. */
export function outlineRect(
  img: Img,
  xy: readonly number[],
  color: readonly number[],
  width: number
): void {
  const [x0, y0, x1, y1] = xy
  for (let y = Math.max(0, y0); y <= Math.min(y1, img.height - 1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(x1, img.width - 1); x++) {
      if (Math.min(x - x0, x1 - x, y - y0, y1 - y) < width) {
        img.data.set(color, (y * img.width + x) * 4)
      }
    }
  }
}

/** Pillow `rotate(deg, resample=BICUBIC, expand=True)` on an RGBA image (premultiplied meanwhile). */
export function rotate(img: Img, deg: number): Img {
  const { width: w, height: h } = img
  const ang = (-(((deg % 360) + 360) % 360) * Math.PI) / 180
  const r15 = (v: number): number => Math.round(v * 1e15) / 1e15
  const m = [r15(Math.cos(ang)), r15(Math.sin(ang)), 0, r15(-Math.sin(ang)), r15(Math.cos(ang)), 0]
  const tf = (x: number, y: number): [number, number] => [
    m[0] * x + m[1] * y + m[2],
    m[3] * x + m[4] * y + m[5]
  ]
  ;[m[2], m[5]] = tf(-w / 2, -h / 2)
  m[2] += w / 2
  m[5] += h / 2
  const corners = [tf(0, 0), tf(w, 0), tf(w, h), tf(0, h)]
  const span = (k: 0 | 1): number =>
    Math.ceil(Math.max(...corners.map((p) => p[k]))) -
    Math.floor(Math.min(...corners.map((p) => p[k])))
  const nw = span(0)
  const nh = span(1)
  ;[m[2], m[5]] = tf(-(nw - w) / 2, -(nh - h) / 2)

  const src = premultiply(img).data
  const out = newImg(nw, nh, 4)
  const cubic = (v1: number, v2: number, v3: number, v4: number, d: number): number =>
    v2 + d * (-v1 + v3 + d * (2 * (v1 - v2) + v3 - v4 + d * (-v1 + v2 - v3 + v4)))
  const xc = (x: number): number => Math.max(0, Math.min(w - 1, x))
  for (let oy = 0; oy < nh; oy++) {
    for (let ox = 0; ox < nw; ox++) {
      let xin = m[0] * (ox + 0.5) + m[1] * (oy + 0.5) + m[2]
      let yin = m[3] * (ox + 0.5) + m[4] * (oy + 0.5) + m[5]
      if (xin < 0 || xin >= w || yin < 0 || yin >= h) {
        continue
      }
      xin -= 0.5
      yin -= 0.5
      const x = Math.floor(xin)
      const y = Math.floor(yin)
      const dx = xin - x
      const dy = yin - y
      const xs = [xc(x - 1), xc(x), xc(x + 1), xc(x + 2)]
      for (let c = 0; c < 4; c++) {
        const row = (yy: number): number => {
          const o = yy * w
          return cubic(
            ...(xs.map((sx) => src[(o + sx) * 4 + c]) as [number, number, number, number]),
            dx
          )
        }
        // Rows below the image repeat the row before them, as in Pillow's BICUBIC_BODY.
        const v1 = row(Math.max(0, Math.min(h - 1, y - 1)))
        const v2 = y >= 0 && y < h ? row(y) : v1
        const v3 = y + 1 >= 0 && y + 1 < h ? row(y + 1) : v2
        const v4 = y + 2 >= 0 && y + 2 < h ? row(y + 2) : v3
        const v = cubic(v1, v2, v3, v4, dy)
        out.data[(oy * nw + ox) * 4 + c] = v < 0 ? 0 : v >= 255 ? 255 : Math.trunc(v)
      }
    }
  }
  unpremultiply(out)
  return out
}
