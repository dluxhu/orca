// The bundled style thumbnails of ProfileStyleGrid: each style on the Orca icon with the placeholder
// badge, from the real core. To make them again (macOS, about a minute):
//   ORCA_WRITE_STYLE_THUMBNAILS=1 pnpm exec vitest run --config config/vitest.config.ts <this file>
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_STYLES, renderBadgedIcon } from '../../../../shared/icon-badger/badger'
import { resize } from '../../../../shared/icon-badger/resample'
import { rasterizeWithAppKit } from '../../../../cli/app-profiles/app-profile-icon'
import { decodePng, encodePng, largestIcnsPng } from '../../../../cli/app-profiles/app-profile-icns'

const dir = join(__dirname, '..', '..', 'assets', 'profile-icon-styles')
// 2x of the 48 px tile.
const SIZE = 96
// An emoji reads as a placeholder; the user's own badge is in the preview.
const PLACEHOLDER = '🙂'

describe('profile style thumbnails', () => {
  it.runIf(process.env.ORCA_WRITE_STYLE_THUMBNAILS === '1' && process.platform === 'darwin')(
    'writes the thumbnails',
    { timeout: 300_000 },
    () => {
      const icns = readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', 'resources', 'build', 'icon.icns')
      )
      const base = decodePng(largestIcnsPng(icns)!)!
      expect(base.width).toBe(1024)
      const badge = rasterizeWithAppKit('text', PLACEHOLDER)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      for (const style of ICON_STYLES) {
        const img = resize(renderBadgedIcon(base, badge, style), SIZE, SIZE)
        writeFileSync(join(dir, `${style}.png`), encodePng(img))
      }
    }
  )

  it('has one 96 px PNG for each style, and no other file', () => {
    expect(readdirSync(dir).sort()).toEqual(ICON_STYLES.map((style) => `${style}.png`).sort())
    for (const style of ICON_STYLES) {
      const img = decodePng(readFileSync(join(dir, `${style}.png`)))
      expect([img?.width, img?.height]).toEqual([SIZE, SIZE])
    }
  })
})
