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

// ---------------------------------------------------------------- Gaussian blur

/** Pillow `_gaussian_blur_radius`: the box radius of one of `passes` box blurs. */
function boxRadius(radius: number, passes: number): number {
  const sigma2 = f32(f32(radius * radius) / passes)
  const L = f32(Math.sqrt(12.0 * sigma2 + 1.0))
  const l = f32(Math.floor((L - 1.0) / 2.0))
  let a = f32(f32(2 * l + 1) * f32(f32(l * f32(l + 1)) - f32(3 * sigma2)))
  a = f32(a / f32(6 * f32(sigma2 - f32(f32(l + 1) * f32(l + 1)))))
  return f32(l + a)
}

/** Pillow `ImagingHorizontalBoxBlur` in place. */
function boxBlurRows(img: Img, floatRadius: number): void {
  const { width: w, height: h, channels: ch, data } = img
  const radius = Math.trunc(floatRadius)
  const ww = Math.trunc(f32(16777216 / f32(f32(floatRadius * 2) + 1)))
  const fw = Math.floor((16777216 - (radius * 2 + 1) * ww) / 2)
  const edgeA = Math.min(radius + 1, w)
  const edgeB = Math.max(w - radius - 1, 0)
  const lastx = w - 1
  const line = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    const row = y * w * ch
    for (let c = 0; c < ch; c++) {
      for (let x = 0; x < w; x++) {
        line[x] = data[row + x * ch + c]
      }
      let acc = line[0] * (radius + 1)
      for (let x = 0; x < edgeA - 1; x++) {
        acc += line[x]
      }
      acc += line[lastx] * (radius - edgeA + 1)
      const step = (x: number, sub: number, add: number, left: number, right: number): void => {
        acc += line[add] - line[sub]
        const bulk = acc * ww + (line[left] + line[right]) * fw
        data[row + x * ch + c] = Math.floor((bulk + 8388608) / 16777216)
      }
      if (edgeA <= edgeB) {
        for (let x = 0; x < edgeA; x++) step(x, 0, x + radius, 0, x + radius + 1)
        for (let x = edgeA; x < edgeB; x++)
          step(x, x - radius - 1, x + radius, x - radius - 1, x + radius + 1)
        for (let x = edgeB; x <= lastx; x++) step(x, x - radius - 1, lastx, x - radius - 1, lastx)
      } else {
        for (let x = 0; x < edgeB; x++) step(x, 0, x + radius, 0, x + radius + 1)
        for (let x = edgeB; x < edgeA; x++) step(x, 0, lastx, 0, lastx)
        for (let x = edgeA; x <= lastx; x++) step(x, x - radius - 1, lastx, x - radius - 1, lastx)
      }
    }
  }
}

function transpose(img: Img): Img {
  const out = newImg(img.height, img.width, img.channels)
  const ch = img.channels
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      for (let c = 0; c < ch; c++) {
        out.data[(x * img.height + y) * ch + c] = img.data[(y * img.width + x) * ch + c]
      }
    }
  }
  return out
}

/** ImageFilter.GaussianBlur(radius): three extended box blurs in each direction, channels raw. */
export function gaussianBlur(img: Img, radius: number): Img {
  const r = boxRadius(f32(radius), 3)
  const out = cloneImg(img)
  for (let i = 0; i < 3; i++) boxBlurRows(out, r)
  const t = transpose(out)
  for (let i = 0; i < 3; i++) boxBlurRows(t, r)
  return transpose(t)
}

// ---------------------------------------------------------------- resize

type Filter = { support: number; fn: (x: number) => number }

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(x * Math.PI) / (x * Math.PI))
export const LANCZOS: Filter = {
  support: 3,
  fn: (x) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0)
}
export const BOX: Filter = { support: 0.5, fn: (x) => (x > -0.5 && x <= 0.5 ? 1 : 0) }

const PRECISION_BITS = 22

/** Pillow `precompute_coeffs` with `normalize_coeffs_8bpc`. */
function coeffs(inSize: number, outSize: number, filter: Filter) {
  const scale = inSize / outSize
  const filterscale = Math.max(scale, 1)
  const support = filter.support * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const kk = new Int32Array(outSize * ksize)
  const w = new Float64Array(ksize)
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    const ss = 1.0 / filterscale
    const xmin = Math.max(0, Math.trunc(center - support + 0.5))
    const xmax = Math.min(inSize, Math.trunc(center + support + 0.5)) - xmin
    let ww = 0
    for (let x = 0; x < xmax; x++) {
      w[x] = filter.fn((x + xmin - center + 0.5) * ss)
      ww += w[x]
    }
    for (let x = 0; x < xmax; x++) {
      const k = ww !== 0 ? w[x] / ww : w[x]
      kk[xx * ksize + x] = Math.trunc(k < 0 ? -0.5 + k * (1 << PRECISION_BITS) : 0.5 + k * (1 << PRECISION_BITS))
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { ksize, bounds, kk }
}

const clip8 = (v: number): number => Math.max(0, Math.min(255, Math.floor(v / (1 << PRECISION_BITS))))

function resampleRows(img: Img, outW: number, filter: Filter): Img {
  const { ksize, bounds, kk } = coeffs(img.width, outW, filter)
  const ch = img.channels
  const out = newImg(outW, img.height, ch)
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * ch
    for (let xx = 0; xx < outW; xx++) {
      const xmin = bounds[xx * 2]
      const xmax = bounds[xx * 2 + 1]
      for (let c = 0; c < ch; c++) {
        let ss = 1 << (PRECISION_BITS - 1)
        for (let x = 0; x < xmax; x++) {
          ss += img.data[row + (x + xmin) * ch + c] * kk[xx * ksize + x]
        }
        out.data[(y * outW + xx) * ch + c] = clip8(ss)
      }
    }
  }
  return out
}

/** Pillow `Image.resize` (two passes, 8-bit between them; RGBA is premultiplied meanwhile). */
export function resize(img: Img, width: number, height: number, filter: Filter = LANCZOS): Img {
  if (width === img.width && height === img.height) {
    return cloneImg(img)
  }
  let work = img
  if (img.channels === 4) {
    work = cloneImg(img)
    const d = work.data
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const tmp = d[i + c] * d[i + 3] + 128
        d[i + c] = ((tmp >> 8) + tmp) >> 8
      }
    }
  }
  if (width !== work.width) {
    work = resampleRows(work, width, filter)
  }
  if (height !== work.height) {
    work = transpose(resampleRows(transpose(work), height, filter))
  }
  if (img.channels === 4) {
    const d = work.data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      if (a !== 0 && a !== 255) {
        for (let c = 0; c < 3; c++) {
          d[i + c] = Math.min(255, Math.floor((255 * d[i + c]) / a))
        }
      }
    }
  }
  return work
}

// ---------------------------------------------------------------- polygon fill

const roundUp = (f: number): number => (f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5))
const roundDown = (f: number): number => (f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5))

/** ImageDraw.polygon(points, fill=value) on an "L" image (Pillow `polygon_generic`). */
export function fillPolygon(img: Img, points: readonly (readonly [number, number])[], value = 255): void {
  const p = points.map(([x, y]) => [roundUp(x), roundUp(y)])
  type Edge = { x0: number; y0: number; ymin: number; ymax: number; dx: number }
  const edges: Edge[] = []
  const hline = (x0: number, y: number, x1: number): void => {
    if (y < 0 || y >= img.height) return
    if (x0 > x1) [x0, x1] = [x1, x0]
    if (x0 >= img.width || x1 < 0) return
    img.data.fill(value, y * img.width + Math.max(0, x0), y * img.width + Math.min(x1, img.width - 1) + 1)
  }
  const pairs: [number[], number[]][] = []
  for (let i = 0; i < p.length - 1; i++) pairs.push([p[i], p[i + 1]])
  const last = p[p.length - 1]
  if (last[0] !== p[0][0] || last[1] !== p[0][1]) pairs.push([last, p[0]])
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
        if (y === e.ymax && y < ymax) xx.push(x)
      }
    }
    xx.sort((a, b) => a - b)
    for (let i = 1; i < xx.length; i += 2) {
      const xEnd = roundDown(xx[i])
      if (xEnd < xx[i - 1]) continue
      const xStart = roundUp(xx[i - 1])
      if (xStart > xEnd) continue
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
  if (background === value) return
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
