import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  buildMacProfileManagerApp,
  macProfileManagerSignIgnore
} = require('./macos-profile-manager-app.cjs')
const { assertMacExecutableUuid } = require('./macos-executable-uuid.cjs')
// The runtime reads these. The build script has its own copies.
const { APP_ROLE_PLIST_KEY, PROFILE_MANAGER_ROLE, profileManagerAppPath } =
  await import('../../../../src/shared/app-profiles/app-profile-paths.ts')

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux</string>
  <key>CFBundleExecutable</key><string>Orca</string>
  <key>CFBundleName</key><string>Orca</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>orca</string></array></dict></array>
  <key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeRole</key><string>Editor</string></dict></array>
</dict></plist>
`

let dir
let app
let signed

function file(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function plistValue(path, key) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-manager-app-'))
  app = join(dir, 'Orca.app')
  const contents = join(app, 'Contents')
  file(join(contents, 'Info.plist'), PLIST)
  file(join(contents, 'PkgInfo'), 'APPL????')
  // A real Mach-O file, so that the UUID step runs as in a build.
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  copyFileSync('/usr/bin/true', join(contents, 'MacOS', 'Orca'))
  file(join(contents, 'MacOS', 'orca-keyboard-layout'), 'layout')
  file(join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'x'), 'fw')
  file(join(contents, 'Frameworks', 'Orca Helper (GPU).app', 'Contents', 'MacOS', 'h'), 'gpu')
  file(join(contents, 'Frameworks', 'Squirrel.framework', 'Versions', 'A', 'y'), 'squirrel')
  file(join(contents, 'Resources', 'app.asar'), 'asar')
  file(join(contents, 'Resources', 'bin', 'orca'), 'cli')
  signed = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const build = () =>
  buildMacProfileManagerApp({
    appPath: app,
    appId: 'com.stablyai.orca.dlux',
    executable: 'Orca',
    signCode: async (path) => signed.push(['code', path]),
    signBundle: async (path) => signed.push(['bundle', path])
  })

describe.skipIf(process.platform !== 'darwin')('buildMacProfileManagerApp', () => {
  it('nests the app with its own id and copies, and relative links into the outer app', async () => {
    const bundle = await build()
    expect(bundle).toBe(profileManagerAppPath(app))
    const contents = join(bundle, 'Contents')
    const plist = join(contents, 'Info.plist')
    expect(plistValue(plist, 'CFBundleIdentifier')).toBe('com.stablyai.orca.dlux.profile-manager')
    expect(plistValue(plist, 'CFBundleDisplayName')).toBe('Orca Profile Manager')
    expect(plistValue(plist, APP_ROLE_PLIST_KEY)).toBe(PROFILE_MANAGER_ROLE)
    // Helpers are found by CFBundleName, so it stays.
    expect(plistValue(plist, 'CFBundleName')).toBe('Orca')
    expect(plistValue(plist, 'CFBundleURLTypes')).toBeNull()
    expect(plistValue(plist, 'CFBundleDocumentTypes')).toBeNull()

    const executable = join(contents, 'MacOS', 'Orca')
    expect(lstatSync(executable).isFile()).toBe(true)
    assertMacExecutableUuid(executable, 'com.stablyai.orca.dlux.profile-manager')
    for (const copy of ['Electron Framework.framework', 'Orca Helper (GPU).app']) {
      expect(lstatSync(join(contents, 'Frameworks', copy)).isDirectory()).toBe(true)
    }
    for (const [link, target] of [
      [join('Frameworks', 'Squirrel.framework'), join('Frameworks', 'Squirrel.framework')],
      [join('Resources', 'app.asar'), join('Resources', 'app.asar')],
      [join('Resources', 'bin'), join('Resources', 'bin')]
    ]) {
      const path = join(contents, link)
      expect(readlinkSync(path).startsWith('..')).toBe(true)
      expect(realpathSync(path)).toBe(realpathSync(join(app, 'Contents', target)))
    }
  })

  it('signs the copied code before the nested bundle', async () => {
    const bundle = await build()
    expect(signed).toEqual([
      ['code', join(bundle, 'Contents', 'Frameworks', 'Electron Framework.framework')],
      ['code', join(bundle, 'Contents', 'Frameworks', 'Orca Helper (GPU).app')],
      ['bundle', bundle]
    ])
  })

  it('makes the nested app again on a second pack', async () => {
    await build()
    await expect(build()).resolves.toContain('Orca Profile Manager.app')
  })
})

describe('macProfileManagerSignIgnore', () => {
  const ignored = (path) => macProfileManagerSignIgnore.some((pattern) => path.match(pattern))
  it('keeps electron-builder out of the nested app only', () => {
    const nested = profileManagerAppPath('/b/Orca.app')
    expect(ignored(nested)).toBe(true)
    expect(ignored(`${nested}/Contents/Resources/app.asar.unpacked/x.node`)).toBe(true)
    expect(ignored('/b/Orca.app/Contents/Resources/app.asar.unpacked/x.node')).toBe(false)
    expect(ignored('/b/Orca.app/Contents/Frameworks/Electron Framework.framework')).toBe(false)
  })
})
