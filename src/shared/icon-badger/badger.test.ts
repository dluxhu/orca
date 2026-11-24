// Golden tests against dock-icon-badger's own output. The fixtures come from the public
// dock-icon-badger repository at commit 7aea7a95508a955051f347536896db87c3bd0199 (MIT):
//   swirl-app.png = samples/apps/Swirl.png, beta-badge.png = samples/badges/beta.png,
//   swirl-beta-<style>-192.png = web/thumbs/<style>.png, which examples/make_gallery.py makes with
//   render(App(Swirl), Logo(beta), style).resize((192, 192), LANCZOS).
// Download command for each style, into a new empty directory:
//   curl -sSfL -o t.png https://raw.githubusercontent.com/dluxhu/dock-icon-badger/<commit>/web/thumbs/<style>.png
// The limit is the one of docs/fork/profiles-design.md, section 8.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { pageCurl, renderBadgedIcon, type IconStyle } from './badger'
import { normalizeIcon } from './normalize'
import { Logo } from './logo'
import type { Img } from './raster'
import { resize } from './resample'

const fixture = (name: string): Img => {
  const png = PNG.sync.read(readFileSync(join(__dirname, '__fixtures__', name)))
  return { width: png.width, height: png.height, channels: 4, data: new Uint8Array(png.data) }
}

/** Differences on premultiplied RGBA, as the design's limit says. */
function compare(a: Img, b: Img, label: string) {
  expect([a.width, a.height]).toEqual([b.width, b.height])
  const pre = (d: Uint8Array, i: number): number =>
    i % 4 === 3 ? d[i] : (d[i] * d[i - (i % 4) + 3]) / 255
  let within = 0
  let sum = 0
  let max = 0
  const diff = new PNG({ width: a.width, height: a.height })
  for (let p = 0; p < a.width * a.height; p++) {
    let worst = 0
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(pre(a.data, p * 4 + c) - pre(b.data, p * 4 + c))
      sum += d
      worst = Math.max(worst, d)
    }
    max = Math.max(max, worst)
    if (worst <= 8) {
      within++
    }
    diff.data.set([Math.min(255, worst * 8), 0, 0, 255], p * 4)
  }
  const stats = {
    within8: within / (a.width * a.height),
    mean: sum / (a.width * a.height * 4),
    max: Math.round(max)
  }
  if (stats.within8 < 0.995 || stats.mean > 1 || stats.max > 48) {
    const path = join(tmpdir(), `icon-badger-diff-${label}.png`)
    writeFileSync(path, PNG.sync.write(diff))
    console.log(`difference image: ${path}`)
  }
  return stats
}

describe('icon badger golden tests', () => {
  it('classifies the Swirl sample as macOS-shaped', () => {
    expect(normalizeIcon(fixture('swirl-app.png')).kind).toBe('macOS-shaped')
  })

  // The reference badge came from beta.svg (cairo at 4096 px); the test uses beta.png. For
  // ref-match that moves the badge across the 16 % overlap limit of the size search (326 px here,
  // 322 px in the reference). So the test fixes the reference's height, and the search has its own test.
  const referenceHeights: Partial<Record<IconStyle, number>> = { 'ref-match': 322 }

  it('finds the badge size with the overlap search', { timeout: 120_000 }, () => {
    const flat = normalizeIcon(fixture('swirl-app.png')).flat
    const fit = pageCurl(flat, new Logo(fixture('beta-badge.png')))
    expect(fit.h).toBe(326)
    expect(fit.c).toBeGreaterThanOrEqual(0.08)
    expect(fit.c).toBeLessThanOrEqual(0.16)
  })

  // The style ids of dock-icon-badger, in the order of its STYLES table.
  const golden = [
    'white-tile',
    'tint-tile',
    'frosted',
    'round',
    'stamp',
    'liquid-glass',
    'ref-match',
    'ref-match-bigger'
  ] as IconStyle[]

  for (const style of golden) {
    it(`matches dock-icon-badger ${style}`, { timeout: 120_000 }, () => {
      const out = renderBadgedIcon(
        fixture('swirl-app.png'),
        fixture('beta-badge.png'),
        style,
        referenceHeights[style]
      )
      const stats = compare(resize(out, 192, 192), fixture(`swirl-beta-${style}-192.png`), style)
      console.log(style, stats)
      expect(stats.within8).toBeGreaterThanOrEqual(0.995)
      expect(stats.mean).toBeLessThanOrEqual(1)
      expect(stats.max).toBeLessThanOrEqual(48)
    })
  }
})
