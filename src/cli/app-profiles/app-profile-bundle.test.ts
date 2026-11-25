import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshAppProfileBundle } from './app-profile-bundle'
import { createAppProfile, type RunTool } from './app-profile-create'

const plist = (version: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux</string>
  <key>CFBundleExecutable</key><string>Orca</string>
  <key>CFBundleName</key><string>Orca</string>
  <key>CFBundleDisplayName</key><string>Orca</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>orca</string></array></dict></array>
</dict>
</plist>
`

let dir: string
let app: string
let calls: string[][]
let failSign: boolean

// Real ditto, cp and plutil; codesign and lsregister are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('codesign')) {
    if (failSign && args[0] === '--force') {
      throw new Error('codesign failed')
    }
    return args[0] === '-d' ? '<plist><dict/></plist>' : ''
  }
  if (program.endsWith('lsregister')) {
    return ''
  }
  return execFileSync(program, args, { encoding: 'utf8' })
}

function file(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, { mode: 0o755 })
}

/** The default app at a version: its runtime files carry the version in their content. */
function defaultApp(version: string): void {
  const contents = join(app, 'Contents')
  rmSync(join(contents, 'MacOS'), { recursive: true, force: true })
  rmSync(join(contents, 'Frameworks'), { recursive: true, force: true })
  file(join(contents, 'Info.plist'), plist(version))
  file(join(contents, 'MacOS', 'Orca'), `main ${version}`)
  file(join(contents, 'MacOS', 'orca-notification-status'), 'default variant')
  file(join(contents, 'Frameworks', 'Electron Framework.framework', 'x'), `fw ${version}`)
  file(join(contents, 'Frameworks', 'Orca Helper.app', 'Contents', 'MacOS', 'h'), `h ${version}`)
  file(join(contents, 'Frameworks', 'Squirrel.framework', 'y'), 'squirrel')
  file(join(contents, 'Resources', 'app.asar'), `asar ${version}`)
  file(join(contents, 'Resources', 'profile-template', 'orca-notification-status'), 'profile')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-refresh-'))
  app = join(dir, 'Orca.app')
  defaultApp('1.0')
  calls = []
  failSign = false
  vi.stubEnv('HOME', dir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const env = (): NodeJS.ProcessEnv => ({
  ORCA_PROFILES_ROOT: join(dir, 'data'),
  ORCA_PROFILES_APPS_DIR: join(dir, 'apps')
})
const read = (path: string): string => readFileSync(path, 'utf8')
const key = (path: string, name: string): string =>
  execFileSync('/usr/bin/plutil', ['-extract', name, 'raw', path], { encoding: 'utf8' }).trim()

describe.skipIf(process.platform !== 'darwin')('refreshAppProfileBundle', () => {
  const make = () => {
    const entry = createAppProfile({
      name: 'Work',
      defaultAppPath: app,
      env: env(),
      run,
      pinRoot: true,
      // The icon renderer needs AppKit; this test needs only an icon file.
      makeIcon: () => ({ icns: Buffer.from('icns'), icon: { kind: 'badge', text: 'W' } })
    })
    const contents = join(entry.appPath, 'Contents')
    // A file of the profile's own in Resources, as an icon change writes one.
    rmSync(join(contents, 'Resources', 'app.asar'))
    file(join(contents, 'Resources', 'own.icns'), 'own icon')
    calls = []
    return { entry, contents }
  }

  it('does no work when the default app has the same version', () => {
    const { entry } = make()
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(false)
    expect(calls).toEqual([])
  })

  it('copies the new runtime and version into the bundle, and keeps the profile parts', () => {
    const { entry, contents } = make()
    defaultApp('2.0')
    file(join(app, 'Contents', 'Resources', 'new.pak'), 'new')
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(true)
    expect(read(join(contents, 'MacOS', 'Orca'))).toBe('main 2.0')
    expect(read(join(contents, 'MacOS', 'orca-notification-status'))).toBe('profile')
    expect(read(join(contents, 'Frameworks', 'Electron Framework.framework', 'x'))).toBe('fw 2.0')
    expect(read(join(contents, 'Frameworks', 'Orca Helper.app', 'Contents', 'MacOS', 'h'))).toBe(
      'h 2.0'
    )
    const plistPath = join(contents, 'Info.plist')
    expect(key(plistPath, 'CFBundleVersion')).toBe('2.0')
    expect(key(plistPath, 'CFBundleIdentifier')).toBe(entry.bundleId)
    expect(key(plistPath, 'CFBundleDisplayName')).toBe('Work')
    expect(key(plistPath, 'OrcaAppProfileId')).toBe('work')
    expect(key(plistPath, 'OrcaAppProfilesRoot')).toBe(join(dir, 'data'))
    expect(read(plistPath)).not.toContain('CFBundleURLTypes')
    // The profile's own file stays; a new Resources entry gets its link.
    expect(read(join(contents, 'Resources', 'own.icns'))).toBe('own icon')
    expect(lstatSync(join(contents, 'Resources', 'new.pak')).isSymbolicLink()).toBe(true)
    // The new bundle is signed before it takes the app's place.
    expect(calls.at(-1)?.[0]).toBe('/usr/bin/codesign')
    expect(calls.at(-1)?.at(-1)).toMatch(/\/\.work\.refresh-[^/]+\/Work\.app$/)
    // The data folder is not touched, and nothing is left next to the app.
    expect(existsSync(join(entry.userDataPath, 'orca-app-profile.json'))).toBe(true)
    expect(readdirSync(join(dir, 'apps'))).toEqual(['Work.app'])
    // The version is recorded: the next start does no work.
    calls = []
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(false)
  })

  it('gives a clear error and leaves the bundle as it was when a step fails', () => {
    const { entry, contents } = make()
    defaultApp('2.0')
    failSign = true
    expect(() => refreshAppProfileBundle(entry.appPath, app, run)).toThrow(
      /Orca could not update the profile app .*Work\.app: codesign failed/
    )
    expect(read(join(contents, 'MacOS', 'Orca'))).toBe('main 1.0')
    expect(key(join(contents, 'Info.plist'), 'CFBundleVersion')).toBe('1.0')
    expect(readdirSync(join(dir, 'apps'))).toEqual(['Work.app'])
  })
})
