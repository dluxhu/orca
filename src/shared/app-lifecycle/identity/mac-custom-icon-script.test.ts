import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeIcns } from '../../../cli/app-profiles/app-profile-icns'
import { MAC_DOCK_ICON_SCRIPT } from './mac-custom-icon-script'

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(process.platform !== 'darwin')('MAC_DOCK_ICON_SCRIPT', () => {
  it('sets the custom icon of a bundle whose path has non-ASCII characters', () => {
    dir = mkdtempSync(join(tmpdir(), 'custom-icon-'))
    const bundle = join(dir, 'Orca - Prófil ü.app')
    mkdirSync(bundle)
    const icon = join(dir, 'ícon.icns')
    const img = { width: 16, height: 16, channels: 4, data: new Uint8Array(16 * 16 * 4).fill(200) }
    writeFileSync(icon, writeIcns(img as never))
    execFileSync(
      '/usr/bin/osascript',
      MAC_DOCK_ICON_SCRIPT.flatMap((line) => ['-e', line]),
      { env: { ...process.env, ORCA_APP_BUNDLE_PATH: bundle, ORCA_APP_ICON_PATH: icon } }
    )
    expect(existsSync(join(bundle, 'Icon\r'))).toBe(true)
  })
})
