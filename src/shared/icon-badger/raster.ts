// Raster primitives that copy Pillow's integer algorithms, so the badger output matches
// dock-icon-badger (Python, Pillow). No Electron or Node import: this file runs in Node and in
// the renderer.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo.

/** An 8-bit image: 1 channel (Pillow "L") or 4 channels (Pillow "RGBA", not premultiplied). */
export type Img = { width: number; height: number; channels: 1 | 4; data: Uint8Array }

const f32 = Math.fround

export function newImg(width: number, height: number, channels: 1 | 4, fill?: number[]): Img {
  const data = new Uint8Array(width * height * channels)
  if (fill?.some((v) => v !== 0)) {
    for (let i = 0; i < data.length; i += channels) {
      data.set(fill, i)
    }
  }
  return { width, height, channels, data }
}

export function cloneImg(img: Img): Img {
  return { width: img.width, height: img.height, channels: img.channels, data: img.data.slice() }
}

/** Pillow `getchannel`. */
export function channel(img: Img, c: number): Img {
  const out = newImg(img.width, img.height, 1)
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = img.data[i * img.channels + c]
  }
  return out
}

/** Pillow `putalpha` with an "L" image. */
export function putAlpha(img: Img, alpha: Img): void {
  for (let i = 0; i < alpha.data.length; i++) {
    img.data[i * 4 + 3] = alpha.data[i]
  }
}

/** Pillow `point` with a function: a lookup table of the function's integer results. */
export function point(img: Img, fn: (v: number) => number): Img {
  const lut = Array.from({ length: 256 }, (_, v) => Math.max(0, Math.min(255, Math.trunc(fn(v)))))
  return { ...img, data: img.data.map((v) => lut[v]) }
}

/** ImageChops.multiply: a * b / 255, truncated. */
export function multiply(a: Img, b: Img): Img {
  return { ...a, data: a.data.map((v, i) => Math.trunc((v * b.data[i]) / 255)) }
}

/** ImageChops.subtract with scale 1 and offset 0. */
export function subtract(a: Img, b: Img): Img {
  return { ...a, data: a.data.map((v, i) => Math.max(0, v - b.data[i])) }
}

/** ImageChops.lighter. */
export function lighter(a: Img, b: Img): Img {
  return { ...a, data: a.data.map((v, i) => Math.max(v, b.data[i])) }
}

export function crop(img: Img, x0: number, y0: number, x1: number, y1: number): Img {
  const out = newImg(x1 - x0, y1 - y0, img.channels)
  const ch = img.channels
  for (let y = Math.max(0, y0); y < Math.min(y1, img.height); y++) {
    const sx0 = Math.max(0, x0)
    const sx1 = Math.min(x1, img.width)
    if (sx1 <= sx0) {
      continue
    }
    out.data.set(
      img.data.subarray((y * img.width + sx0) * ch, (y * img.width + sx1) * ch),
      ((y - y0) * out.width + (sx0 - x0)) * ch
    )
  }
  return out
}

/** Pillow `getbbox` (alpha only for RGBA): [x0, y0, x1, y1), or null when all is zero. */
export function bbox(img: Img): [number, number, number, number] | null {
  const ch = img.channels
  const off = ch === 4 ? 3 : 0
  let x0 = img.width
  let y0 = img.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * ch + off] !== 0) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]
}

// ---------------------------------------------------------------- alpha compositing

/** Pillow `Image.alpha_composite(src, dest)` in place; parts outside dst are dropped. */
export function alphaComposite(dst: Img, src: Img, dx = 0, dy = 0): void {
  const d = dst.data
  const s = src.data
  for (let y = Math.max(0, -dy); y < src.height && y + dy < dst.height; y++) {
    for (let x = Math.max(0, -dx); x < src.width && x + dx < dst.width; x++) {
      const si = (y * src.width + x) * 4
      const sa = s[si + 3]
      if (sa === 0) {
        continue
      }
      const di = ((y + dy) * dst.width + x + dx) * 4
      const blend = d[di + 3] * (255 - sa)
      const outa255 = sa * 255 + blend
      const coef1 = Math.floor((sa * 255 * 255 * 128) / outa255)
      const coef2 = 255 * 128 - coef1
      for (let c = 0; c < 3; c++) {
        const tmp = s[si + c] * coef1 + d[di + c] * coef2 + (0x80 << 7)
        d[di + c] = Math.floor((Math.floor(tmp / 256) + tmp) / 256) >> 7
      }
      const ta = outa255 + 0x80
      d[di + 3] = Math.floor((Math.floor(ta / 256) + ta) / 256)
    }
  }
}

function div255(a: number): number {
  const tmp = a + 128
  return ((tmp >> 8) + tmp) >> 8
}

/** Pillow `paste(src, (dx, dy), src)` with an RGBA source as its own mask. */
export function pasteSelfMasked(dst: Img, src: Img, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4
      const di = ((y + dy) * dst.width + x + dx) * 4
      const m = src.data[si + 3]
      for (let c = 0; c < 4; c++) {
        dst.data[di + c] = div255(dst.data[di + c] * (255 - m) + src.data[si + c] * m)
      }
    }
  }
}

// ---------------------------------------------------------------- polygon fill

const roundUp = (f: number): number =>
  f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5)
const roundDown = (f: number): number =>
  f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5)

/** ImageDraw.polygon(points, fill=value) on an "L" image (Pillow `polygon_generic`). */
export function fillPolygon(
  img: Img,
  points: readonly (readonly [number, number])[],
  value = 255
): void {
  const p = points.map(([x, y]) => [roundUp(x), roundUp(y)])
  type Edge = { x0: number; y0: number; ymin: number; ymax: number; dx: number }
  const edges: Edge[] = []
  const hline = (x0: number, y: number, x1: number): void => {
    if (y < 0 || y >= img.height) {
      return
    }
    if (x0 > x1) {
      ;[x0, x1] = [x1, x0]
    }
    if (x0 >= img.width || x1 < 0) {
      return
    }
    img.data.fill(
      value,
      y * img.width + Math.max(0, x0),
      y * img.width + Math.min(x1, img.width - 1) + 1
    )
  }
  const pairs: [number[], number[]][] = []
  for (let i = 0; i < p.length - 1; i++) {
    pairs.push([p[i], p[i + 1]])
  }
  const last = p.at(-1)
  if (last[0] !== p[0][0] || last[1] !== p[0][1]) {
    pairs.push([last, p[0]])
  }
  let ymin = img.height - 1
  let ymax = 0
  for (const [[x0, y0], [x1, y1]] of pairs) {
    const e = { x0, y0, ymin: Math.min(y0, y1), ymax: Math.max(y0, y1), dx: 0 }
    ymin = Math.min(ymin, e.ymin)
    ymax = Math.max(ymax, e.ymax)
    if (y0 === y1) {
      hline(Math.min(x0, x1), y0, Math.max(x0, x1))
      continue
    }
    e.dx = f32((x1 - x0) / (y1 - y0))
    edges.push(e)
  }
  ymin = Math.max(ymin, 0)
  ymax = Math.min(ymax, img.height)
  const xx: number[] = []
  for (let y = ymin; y <= ymax; y++) {
    xx.length = 0
    for (const e of edges) {
      if (y >= e.ymin && y <= e.ymax) {
        const x = f32(f32((y - e.y0) * e.dx) + e.x0)
        xx.push(x)
        if (y === e.ymax && y < ymax) {
          xx.push(x)
        }
      }
    }
    xx.sort((a, b) => a - b)
    for (let i = 1; i < xx.length; i += 2) {
      const xEnd = roundDown(xx[i])
      if (xEnd < xx[i - 1]) {
        continue
      }
      const xStart = roundUp(xx[i - 1])
      if (xStart > xEnd) {
        continue
      }
      hline(xStart, y, xEnd)
    }
  }
}

// ---------------------------------------------------------------- rank filters and flood fill

function rank(img: Img, size: number, pick: (a: number, b: number) => number): Img {
  const half = size >> 1
  const { width: w, height: h } = img
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = src[y * w + x]
        for (let k = -half; k <= half; k++) {
          const sx = horizontal ? Math.max(0, Math.min(w - 1, x + k)) : x
          const sy = horizontal ? y : Math.max(0, Math.min(h - 1, y + k))
          v = pick(v, src[sy * w + sx])
        }
        out[y * w + x] = v
      }
    }
    return out
  }
  return { ...img, data: pass(pass(img.data, true), false) }
}

/** ImageFilter.MinFilter(size) on an "L" image (edges repeat). */
export const minFilter = (img: Img, size: number): Img => rank(img, size, Math.min)
/** ImageFilter.MaxFilter(size) on an "L" image (edges repeat). */
export const maxFilter = (img: Img, size: number): Img => rank(img, size, Math.max)

/** ImageDraw.floodfill on an "L" image: 4-connected, exact match. */
export function floodFill(img: Img, x: number, y: number, value: number): void {
  const { width: w, height: h, data } = img
  const background = data[y * w + x]
  if (background === value) {
    return
  }
  const stack = [y * w + x]
  data[y * w + x] = value
  while (stack.length > 0) {
    const i = stack.pop()!
    const px = i % w
    const py = (i - px) / w
    for (const [nx, ny] of [
      [px + 1, py],
      [px - 1, py],
      [px, py + 1],
      [px, py - 1]
    ]) {
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx] === background) {
        data[ny * w + nx] = value
        stack.push(ny * w + nx)
      }
    }
  }
}
