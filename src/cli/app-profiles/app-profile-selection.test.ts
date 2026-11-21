import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { selectAppProfile } from './app-profile-selection'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-app-profiles-'))
  const appPath = join(root, 'Work.app')
  mkdirSync(join(appPath, 'Contents'), { recursive: true })
  writeFileSync(
    join(appPath, 'Contents', 'Info.plist'),
    '<dict><key>CFBundleExecutable</key>\n<string>Orca @dLux</string></dict>'
  )
  mkdirSync(join(root, 'work'))
  writeFileSync(join(root, 'work', 'orca-app-profile.json'), '{"id":"work"}')
  writeFileSync(
    join(root, 'profiles.json'),
    JSON.stringify({ profiles: [{ id: 'work', appPath, userDataPath: join(root, 'work') }] })
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('selectAppProfile', () => {
  it('removes --profile before the command and points the CLI at the profile', () => {
    const env: NodeJS.ProcessEnv = { ORCA_PROFILES_ROOT: root }
    expect(selectAppProfile(['--profile', 'work', 'chat', 'list'], env)).toEqual(['chat', 'list'])
    expect(env.ORCA_USER_DATA_PATH).toBe(join(root, 'work'))
    expect(env.ORCA_APP_EXECUTABLE).toBe(join(root, 'Work.app', 'Contents', 'MacOS', 'Orca @dLux'))
  })

  it('keeps a --profile after the command for the browser', () => {
    const env: NodeJS.ProcessEnv = { ORCA_PROFILES_ROOT: root }
    const argv = ['tab', 'open', '--profile', 'x']
    expect(selectAppProfile(argv, env)).toEqual(argv)
    expect(env.ORCA_USER_DATA_PATH).toBeUndefined()
  })

  it('uses ORCA_PROFILE, and --profile=<id> wins over it', () => {
    const env: NodeJS.ProcessEnv = { ORCA_PROFILES_ROOT: root, ORCA_PROFILE: 'work' }
    expect(selectAppProfile(['status'], env)).toEqual(['status'])
    expect(env.ORCA_USER_DATA_PATH).toBe(join(root, 'work'))
    expect(selectAppProfile(['--profile=default', 'status'], env)).toEqual(['status'])
    expect(env.ORCA_USER_DATA_PATH).toBeUndefined()
    expect(env.ORCA_APP_EXECUTABLE).toBeUndefined()
  })

  it('finds the executable from the marker of an inherited ORCA_USER_DATA_PATH', () => {
    // A profile terminal or the serve LaunchAgent has no ORCA_PROFILES_ROOT.
    const env: NodeJS.ProcessEnv = { ORCA_USER_DATA_PATH: join(root, 'work') }
    selectAppProfile(['serve'], env)
    expect(env.ORCA_APP_EXECUTABLE).toBe(join(root, 'Work.app', 'Contents', 'MacOS', 'Orca @dLux'))
  })

  it('names the known profiles for an unknown id', () => {
    expect(() =>
      selectAppProfile(['--profile', 'nope', 'status'], { ORCA_PROFILES_ROOT: root })
    ).toThrow('No profile "nope". Profiles: default, work.')
  })
})
