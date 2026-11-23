import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

import { applyAppProfileSettingsSeed, configureAppProfileStartup } from './app-profile-startup'
import { serveServiceUnitOf } from '../../cli/app-profiles/app-profile-list'

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

  it('records a rename in Finder in the registry and in its own serve unit', () => {
    const userDataPath = join(home, 'data', 'work')
    const oldApp = join(home, 'apps', 'Orca - Work.app')
    const newApp = join(home, 'apps', 'Orca - Finder.app')
    mkdirSync(join(newApp, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(
      join(home, 'data', 'profiles.json'),
      JSON.stringify({
        profiles: [{ id: 'work', name: 'Orca - Work', appPath: oldApp, userDataPath }]
      })
    )
    const { unitPath } = serveServiceUnitOf(userDataPath, false, home)
    mkdirSync(join(unitPath, '..'), { recursive: true })
    writeFileSync(unitPath, `<string>${oldApp}/Contents/Resources/bin</string>`)
    const execPath = process.execPath
    Object.defineProperty(process, 'execPath', {
      value: join(newApp, 'Contents', 'MacOS', 'Orca'),
      configurable: true
    })
    try {
      profile.current = { id: 'work', userDataPath }
      configureAppProfileStartup(false)
    } finally {
      Object.defineProperty(process, 'execPath', { value: execPath, configurable: true })
    }
    const registry = JSON.parse(readFileSync(join(home, 'data', 'profiles.json'), 'utf8'))
    expect(registry.profiles[0]).toMatchObject({ name: 'Orca - Finder', appPath: newApp })
    expect(readFileSync(unitPath, 'utf8')).toBe(`<string>${newApp}/Contents/Resources/bin</string>`)
  })

  it('does nothing for the default app', () => {
    profile.current = null
    expect(configureAppProfileStartup(false)).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
    expect(setName).not.toHaveBeenCalled()
  })
})

describe('applyAppProfileSettingsSeed', () => {
  it('applies the copied settings once and removes the seed', () => {
    const folder = join(home, 'seeded')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'orca-settings-seed.json'), JSON.stringify({ theme: 'dark' }))
    const updateSettings = vi.fn()
    applyAppProfileSettingsSeed(folder, { updateSettings })
    applyAppProfileSettingsSeed(folder, { updateSettings })
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(existsSync(join(folder, 'orca-settings-seed.json'))).toBe(false)
  })
})
