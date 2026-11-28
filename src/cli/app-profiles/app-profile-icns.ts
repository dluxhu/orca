// PNG and .icns files for profile icons, on node:zlib. See docs/fork/profiles-design.md, section 8.
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import type { Img } from '../../shared/icon-badger/raster'
import { LANCZOS, resize } from '../../shared/icon-badger/resample'

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length)
  head.write(type, 4, 'latin1')
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0)
  return Buffer.concat([head, data, sum])
}

/** An 8-bit RGBA PNG. */
export function encodePng(img: Img): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Decodes an 8-bit RGB or RGBA PNG without interlace; null for any other PNG. */
export function decodePng(png: Buffer): Img | null {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) {
        return null
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let pred = 0
      if (filter === 1) {
        pred = a
      } else if (filter === 2) {
        pred = b
      } else if (filter === 3) {
        pred = (a + b) >> 1
      } else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = (line[i] + pred) & 0xff
    }
  }
  if (bpp === 4) {
    return { width, height, channels: 4, data: pixels }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data.set(pixels.subarray(i * 3, i * 3 + 3), i * 4)
    data[i * 4 + 3] = 255
  }
  return { width, height, channels: 4, data }
}

// ---------------------------------------------------------------- .icns

// The iconset sizes and their types, as `write_icns` in dock_icon_badger.py writes them.
const ICNS_ENTRIES: [type: string, pixels: number][] = [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024]
]

/** An .icns file with one PNG entry for each iconset size. */
export function writeIcns(img: Img): Buffer {
  const entries = ICNS_ENTRIES.map(([type, pixels]) => {
    const png = encodePng(resize(img, pixels, pixels, LANCZOS))
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** The largest PNG entry of an .icns file, or null. */
export function largestIcnsPng(icns: Buffer): Buffer | null {
  let best: Buffer | null = null
  let bestWidth = 0
  for (let offset = 8; offset + 8 <= icns.length;) {
    const length = icns.readUInt32BE(offset + 4)
    if (length < 8) {
      break
    }
    const data = icns.subarray(offset + 8, offset + length)
    if (data.subarray(0, 8).equals(PNG_SIGNATURE) && data.readUInt32BE(16) > bestWidth) {
      best = data
      bestWidth = data.readUInt32BE(16)
    }
    offset += length
  }
  return best
}
