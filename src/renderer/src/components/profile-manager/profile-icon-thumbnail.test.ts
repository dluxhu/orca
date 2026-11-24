import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import type { Img } from '../../../../shared/icon-badger/raster'
import { THUMBNAIL_PX, styleThumbnail } from './profile-icon-thumbnail'

const fixture = (name: string): Img => {
  const path = join(__dirname, '../../../../shared/icon-badger/__fixtures__', name)
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, channels: 4, data: new Uint8Array(png.data) }
}

it('makes a 96 px thumbnail of the 1024 px badged icon', () => {
  const thumb = styleThumbnail(
    { base: fixture('swirl-app.png'), badge: fixture('beta-badge.png') },
    'white-tile'
  )
  expect([thumb.width, thumb.height, thumb.channels]).toEqual([THUMBNAIL_PX, THUMBNAIL_PX, 4])
  // The icon body is opaque in the middle.
  expect(thumb.data[(48 * THUMBNAIL_PX + 48) * 4 + 3]).toBe(255)
})
