import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { setPath, setName, hasSwitch, profile } = vi.hoisted(() => ({
  setPath: vi.fn(),
  setName: vi.fn(),
  hasSwitch: vi.fn(() => false),
  profile: { current: null as null | { id: string; userDataPath: string } }
}))
vi.mock('electron', () => ({ app: { setPath, setName, commandLine: { hasSwitch } } }))
vi.mock('./app-profile', () => ({ getAppProfile: () => profile.current }))

import { configureAppProfileStartup } from './app-profile-startup'

let home: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-profile-startup-'))
  vi.stubEnv('HOME', home)
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  setPath.mockClear()
  setName.mockClear()
  hasSwitch.mockReturnValue(false)
})

describe('configureAppProfileStartup', () => {
  it('pins the own folder and writes its marker', () => {
    profile.current = { id: 'work', userDataPath: join(home, 'work') }
    expect(configureAppProfileStartup(false)).toBe(profile.current)
    expect(setPath).toHaveBeenCalledWith('userData', join(home, 'work'))
    expect(existsSync(join(home, 'work', 'orca-app-profile.json'))).toBe(true)
    // Its own Keychain item: "orca-work Safe Storage".
    expect(setName).toHaveBeenCalledWith('orca-work')
  })

  it('marks no folder given with --user-data-dir', () => {
    profile.current = { id: 'work', userDataPath: join(home, 'given') }
    hasSwitch.mockReturnValue(true)
    configureAppProfileStartup(false)
    expect(setPath).not.toHaveBeenCalled()
    expect(existsSync(join(home, 'given', 'orca-app-profile.json'))).toBe(false)
    expect(setName).toHaveBeenCalledWith('orca-work')
  })

  it('does nothing for the default app', () => {
    profile.current = null
    expect(configureAppProfileStartup(false)).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
    expect(setName).not.toHaveBeenCalled()
  })
})
