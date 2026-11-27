// Pillow's GaussianBlur(radius) is three extended box blurs with a total variance of radius².
// The test measures that variance on a blurred step edge, so it needs no Pillow output.
import { describe, expect, it } from 'vitest'
import { newImg } from './raster'
import { gaussianBlur } from './resample'

function edgeSigma(radius: number): number {
  const width = 400
  const img = newImg(width, 3, 1)
  for (let y = 0; y < 3; y++) {
    img.data.fill(255, y * width + width / 2, (y + 1) * width)
  }
  const row = gaussianBlur(img, radius).data.subarray(width, 2 * width)
  const step = Array.from({ length: width - 1 }, (_, x) => row[x + 1] - row[x])
  const total = step.reduce((s, d) => s + d, 0)
  const mean = step.reduce((s, d, x) => s + x * d, 0) / total
  return Math.sqrt(step.reduce((s, d, x) => s + (x - mean) ** 2 * d, 0) / total)
}

describe('gaussianBlur', () => {
  it.each([2, 5, 12, 55])(
    'spreads a step edge with a standard deviation of the radius %d',
    (radius) => {
      expect(Math.abs(edgeSigma(radius) / radius - 1)).toBeLessThan(0.05)
    }
  )
})
