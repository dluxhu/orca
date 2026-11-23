// Pillow's GaussianBlur and resize (LANCZOS, BOX) with its fixed-point arithmetic.
//
// Ported from dock-icon-badger (https://github.com/dluxhu/dock-icon-badger), MIT License,
// Copyright (c) 2026 Balazs Szabo.
//
// The algorithms are ported from Pillow (https://python-pillow.org), MIT-CMU License: see
// LICENSE-Pillow in this folder.
import { type Img, cloneImg, newImg } from './raster'

const f32 = Math.fround

// ---------------------------------------------------------------- Gaussian blur

/** Pillow `_gaussian_blur_radius`: the box radius of one of `passes` box blurs. */
function boxRadius(radius: number, passes: number): number {
  const sigma2 = f32(f32(radius * radius) / passes)
  const L = f32(Math.sqrt(12 * sigma2 + 1))
  const l = f32(Math.floor((L - 1) / 2))
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
        for (let x = 0; x < edgeA; x++) {
          step(x, 0, x + radius, 0, x + radius + 1)
        }
        for (let x = edgeA; x < edgeB; x++) {
          step(x, x - radius - 1, x + radius, x - radius - 1, x + radius + 1)
        }
        for (let x = edgeB; x <= lastx; x++) {
          step(x, x - radius - 1, lastx, x - radius - 1, lastx)
        }
      } else {
        for (let x = 0; x < edgeB; x++) {
          step(x, 0, x + radius, 0, x + radius + 1)
        }
        for (let x = edgeB; x < edgeA; x++) {
          step(x, 0, lastx, 0, lastx)
        }
        for (let x = edgeA; x <= lastx; x++) {
          step(x, x - radius - 1, lastx, x - radius - 1, lastx)
        }
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
  for (let i = 0; i < 3; i++) {
    boxBlurRows(out, r)
  }
  const t = transpose(out)
  for (let i = 0; i < 3; i++) {
    boxBlurRows(t, r)
  }
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
    const ss = 1 / filterscale
    const xmin = Math.max(0, Math.trunc(center - support + 0.5))
    const xmax = Math.min(inSize, Math.trunc(center + support + 0.5)) - xmin
    let ww = 0
    for (let x = 0; x < xmax; x++) {
      w[x] = filter.fn((x + xmin - center + 0.5) * ss)
      ww += w[x]
    }
    for (let x = 0; x < xmax; x++) {
      const k = ww !== 0 ? w[x] / ww : w[x]
      kk[xx * ksize + x] = Math.trunc(
        k < 0 ? -0.5 + k * (1 << PRECISION_BITS) : 0.5 + k * (1 << PRECISION_BITS)
      )
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { ksize, bounds, kk }
}

const clip8 = (v: number): number =>
  Math.max(0, Math.min(255, Math.floor(v / (1 << PRECISION_BITS))))

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
