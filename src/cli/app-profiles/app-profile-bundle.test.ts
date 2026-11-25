import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  renameSync,
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

/** The default app at a version. `code`: the content of its runtime files (a new build). */
function defaultApp(version: string, code = version): void {
  const contents = join(app, 'Contents')
  rmSync(join(contents, 'MacOS'), { recursive: true, force: true })
  rmSync(join(contents, 'Frameworks'), { recursive: true, force: true })
  file(join(contents, 'Info.plist'), plist(version))
  file(join(contents, 'MacOS', 'Orca'), `main ${code}`)
  file(join(contents, 'MacOS', 'orca-notification-status'), 'default variant')
  const framework = join(contents, 'Frameworks', 'Electron Framework.framework')
  file(join(framework, 'x'), `fw ${code}`)
  file(join(framework, 'Resources', 'Info.plist'), plist(`electron ${code}`))
  const helper = join(contents, 'Frameworks', 'Orca Helper (Renderer).app', 'Contents')
  file(join(helper, 'MacOS', 'Orca Helper (Renderer)'), `h ${code}`)
  file(join(helper, 'Info.plist'), plist(code))
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
      pinRoot: true
    })
    const contents = join(entry.appPath, 'Contents')
    // A file of the profile's own in Resources, as an icon change writes one.
    rmSync(join(contents, 'Resources', 'app.asar'))
    file(join(contents, 'Resources', 'own.icns'), 'own icon')
    calls = []
    return { entry, contents }
  }

  const forced = () => calls.filter((call) => call.includes('--force'))

  it('does no work when the default app has the same version, with the check file', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    expect(refreshAppProfileBundle(entry.appPath, app, run, check)).toBe(false)
    calls = []
    expect(refreshAppProfileBundle(entry.appPath, app, run, check)).toBe(false)
    expect(calls).toEqual([])
  })

  it('does not copy or sign again when an update keeps the runtime parts', () => {
    const { entry, contents } = make()
    defaultApp('2.0', '1.0')
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(false)
    expect(forced()).toEqual([])
    expect(key(join(contents, 'Info.plist'), 'CFBundleVersion')).toBe('1.0')
  })

  it('copies the new runtime and version into the bundle when they change; keeps the profile parts', () => {
    const { entry, contents } = make()
    const keyBefore = key(join(contents, 'Info.plist'), 'OrcaProfileTemplateKey')
    defaultApp('2.0')
    file(join(app, 'Contents', 'Resources', 'new.pak'), 'new')
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(true)
    expect(read(join(contents, 'MacOS', 'Orca'))).toBe('main 2.0')
    expect(read(join(contents, 'MacOS', 'orca-notification-status'))).toBe('profile')
    expect(read(join(contents, 'Frameworks', 'Electron Framework.framework', 'x'))).toBe('fw 2.0')
    const helper = join(contents, 'Frameworks', 'Work Helper (Renderer).app', 'Contents')
    expect(read(join(helper, 'MacOS', 'Work Helper (Renderer)'))).toBe('h 2.0')
    const plistPath = join(contents, 'Info.plist')
    expect(key(plistPath, 'CFBundleVersion')).toBe('2.0')
    expect(key(plistPath, 'CFBundleIdentifier')).toBe(entry.bundleId)
    expect(key(plistPath, 'CFBundleDisplayName')).toBe('Work')
    expect(key(plistPath, 'OrcaAppProfileId')).toBe('work')
    expect(key(plistPath, 'OrcaAppProfilesRoot')).toBe(join(dir, 'data'))
    expect(read(plistPath)).not.toContain('CFBundleURLTypes')
    expect(key(plistPath, 'OrcaProfileTemplateKey')).not.toBe(keyBefore)
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

  it('does not sign again after a rename alone', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    refreshAppProfileBundle(entry.appPath, app, run, check)
    const renamed = join(dir, 'apps', 'Job.app')
    renameSync(entry.appPath, renamed)
    calls = []
    expect(refreshAppProfileBundle(renamed, app, run, check)).toBe(false)
    expect(calls).toEqual([])
    expect(key(join(renamed, 'Contents', 'Info.plist'), 'CFBundleName')).toBe('Work')
  })

  it('gives the menu bar and the helpers the new name at the next update', () => {
    const { entry } = make()
    const renamed = join(dir, 'apps', 'Job.app')
    renameSync(entry.appPath, renamed)
    // An update with the same runtime parts: only the name differs.
    defaultApp('2.0', '1.0')
    expect(refreshAppProfileBundle(renamed, app, run)).toBe(true)
    const contents = join(renamed, 'Contents')
    expect(key(join(contents, 'Info.plist'), 'CFBundleName')).toBe('Job')
    expect(key(join(contents, 'Info.plist'), 'CFBundleDisplayName')).toBe('Job')
    const helper = join(contents, 'Frameworks', 'Job Helper (Renderer).app')
    expect(read(join(helper, 'Contents', 'MacOS', 'Job Helper (Renderer)'))).toBe('h 1.0')
    expect(key(join(helper, 'Contents', 'Info.plist'), 'CFBundleExecutable')).toBe(
      'Job Helper (Renderer)'
    )
    expect(existsSync(join(contents, 'Frameworks', 'Work Helper (Renderer).app'))).toBe(false)
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
