import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeConfigDirEnvPatch } from './claude-config-dir-pin'

let home: string

// A temp HOME stands for the user's home.
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-claude-pin-'))
  vi.stubEnv('HOME', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('claudeConfigDirEnvPatch', () => {
  it("pins a profile's Claude folder, which the child env does not inherit", () => {
    const profile = join(home, 'Orca Profiles', 'work')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'orca-app-profile.json'), JSON.stringify({ id: 'work' }))
    const profileHome = join(profile, 'orca-home', 'agents', 'claude')
    const env = { CLAUDE_CONFIG_DIR: profileHome }
    expect(claudeConfigDirEnvPatch(profileHome, { env, platform: 'darwin' })).toEqual({
      CLAUDE_CONFIG_DIR: profileHome
    })
  })

  it('does not pin the default folder in the default app', () => {
    expect(claudeConfigDirEnvPatch(join(home, '.claude'), { env: {}, platform: 'darwin' })).toEqual(
      {}
    )
  })

  it('pins a nondefault folder', () => {
    const other = join(home, 'accounts', 'second')
    expect(claudeConfigDirEnvPatch(other, { env: {}, platform: 'darwin' })).toEqual({
      CLAUDE_CONFIG_DIR: other
    })
  })
})
