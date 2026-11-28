import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppProfile, defaultAppOf, type RunTool } from './app-profile-create'

const DEFAULT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux</string>
  <key>CFBundleExecutable</key><string>Orca</string>
  <key>CFBundleName</key><string>Orca</string>
  <key>CFBundleDisplayName</key><string>Orca</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>orca</string></array></dict></array>
  <key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeRole</key><string>Editor</string></dict></array>
  <key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict/></dict>
</dict>
</plist>
`

let dir: string
let app: string
let calls: string[][]

// Real ditto and plutil; codesign and lsregister are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('codesign')) {
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-create-'))
  app = join(dir, 'Orca.app')
  const contents = join(app, 'Contents')
  file(join(contents, 'Info.plist'), DEFAULT_PLIST)
  file(join(contents, 'PkgInfo'), 'APPL????')
  file(join(contents, 'MacOS', 'Orca'), 'main')
  file(join(contents, 'MacOS', 'orca-notification-status'), 'default variant')
  file(join(contents, 'MacOS', 'orca-keyboard-layout'), 'layout')
  file(join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'x'), 'fw')
  const helper = join(contents, 'Frameworks', 'Orca Helper (Renderer).app', 'Contents')
  file(join(helper, 'MacOS', 'Orca Helper (Renderer)'), 'helper')
  file(
    join(helper, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Orca Helper (Renderer)</string>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux.helper.Renderer</string>
</dict></plist>
`
  )
  file(join(contents, 'Frameworks', 'Squirrel.framework', 'Versions', 'A', 'y'), 'squirrel')
  file(join(contents, 'Resources', 'app.asar'), 'asar')
  file(join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js'), 'cli')
  file(
    join(contents, 'Resources', 'profile-template', 'orca-notification-status'),
    'profile variant'
  )
  calls = []
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

function plistValue(path: string, key: string): string | null {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

describe.skipIf(process.platform !== 'darwin')('createAppProfile', () => {
  it('builds the thin bundle: copied executables and helpers, linked frameworks and resources', () => {
    const { adoptedData, ...entry } = createAppProfile({
      name: 'Orca - Work',
      defaultAppPath: app,
      env: env(),
      run,
      now: () => 1,
      pinRoot: true
    })
    expect(adoptedData).toBe(false)
    const contents = join(entry.appPath, 'Contents')
    expect(entry).toEqual({
      id: 'work',
      name: 'Orca - Work',
      bundleId: 'com.stablyai.orca.dlux.profile.work',
      appPath: join(dir, 'apps', 'Orca - Work.app'),
      userDataPath: join(dir, 'data', 'work'),
      port: 6800,
      createdAt: 1
    })
    const isLink = (path: string): boolean => lstatSync(path).isSymbolicLink()
    expect(isLink(join(contents, 'MacOS', 'Orca'))).toBe(false)
    expect(lstatSync(join(contents, 'MacOS', 'Orca')).mode & 0o111).not.toBe(0)
    expect(readFileSync(join(contents, 'MacOS', 'orca-notification-status'), 'utf8')).toBe(
      'profile variant'
    )
    // The helpers carry the profile name: Electron finds them as <CFBundleName> Helper*.app.
    const helper = join(contents, 'Frameworks', 'Orca - Work Helper (Renderer).app')
    expect(isLink(helper)).toBe(false)
    expect(existsSync(join(contents, 'Frameworks', 'Orca Helper (Renderer).app'))).toBe(false)
    expect(
      readFileSync(join(helper, 'Contents', 'MacOS', 'Orca - Work Helper (Renderer)'), 'utf8')
    ).toBe('helper')
    expect(plistValue(join(helper, 'Contents', 'Info.plist'), 'CFBundleExecutable')).toBe(
      'Orca - Work Helper (Renderer)'
    )
    // The Electron framework is a clone: helpers crash when it is a link (slice 1, U4).
    expect(isLink(join(contents, 'Frameworks', 'Electron Framework.framework'))).toBe(false)
    expect(
      readFileSync(
        join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'x'),
        'utf8'
      )
    ).toBe('fw')
    expect(readlinkSync(join(contents, 'Frameworks', 'Squirrel.framework'))).toBe(
      join(app, 'Contents', 'Frameworks', 'Squirrel.framework')
    )
    expect(isLink(join(contents, 'Resources'))).toBe(false)
    // No app.asar link (Electron 45 reads no asar through one): the loader runs the real one.
    expect(existsSync(join(contents, 'Resources', 'app.asar'))).toBe(false)
    expect(readlinkSync(join(contents, 'Resources', 'app.asar.unpacked'))).toBe(
      join(app, 'Contents', 'Resources', 'app.asar.unpacked')
    )
    expect(
      JSON.parse(readFileSync(join(contents, 'Resources', 'app', 'package.json'), 'utf8'))
    ).toEqual({
      name: 'orca',
      private: true,
      main: 'boot.js'
    })

    const plist = join(contents, 'Info.plist')
    expect(plistValue(plist, 'CFBundleIdentifier')).toBe(entry.bundleId)
    expect(plistValue(plist, 'CFBundleDisplayName')).toBe('Orca - Work')
    // The bold menu-bar name, and the name of Electron's helper lookup.
    expect(plistValue(plist, 'CFBundleName')).toBe('Orca - Work')
    expect(
      existsSync(
        join(contents, 'Frameworks', `${plistValue(plist, 'CFBundleName')} Helper (Renderer).app`)
      )
    ).toBe(true)
    expect(plistValue(plist, 'OrcaAppProfileId')).toBe('work')
    expect(plistValue(plist, 'OrcaAppProfilesRoot')).toBe(join(dir, 'data'))
    expect(plistValue(plist, 'CFBundleURLTypes')).toBeNull()
    expect(plistValue(plist, 'ElectronAsarIntegrity')).toBeNull()
    expect(plistValue(plist, 'CFBundleDocumentTypes.0.CFBundleTypeRole')).toBe('Editor')

    // The renamed helper app, with its own entitlements; the small executables; the bundle. Ad hoc,
    // no --deep, no hardened runtime.
    const all = calls.filter((call) => call[0].endsWith('codesign') && call[1] === '--force')
    expect(all[0].slice(1, 5)).toEqual(['--force', '-s', '-', '--entitlements'])
    expect(all[0].at(-1)).toMatch(/Orca - Work Helper \(Renderer\)\.app$/)
    const signs = all.slice(1)
    expect(signs.map((call) => call.at(-1))).toEqual([
      expect.stringMatching(/MacOS\/orca-keyboard-layout$/),
      expect.stringMatching(/MacOS\/orca-notification-status$/),
      expect.stringMatching(/Orca - Work\.app$/)
    ])
    for (const call of signs) {
      expect(call).toEqual(expect.arrayContaining(['-s', '-', '-i', entry.bundleId]))
      expect(call).not.toContain('--deep')
      expect(call).not.toContain('--options')
    }
    expect(calls.at(-1)).toEqual([expect.stringMatching(/lsregister$/), '-f', entry.appPath])

    expect(
      JSON.parse(readFileSync(join(entry.userDataPath, 'orca-app-profile.json'), 'utf8'))
    ).toEqual({
      id: 'work'
    })
    const registry = JSON.parse(readFileSync(join(dir, 'data', 'profiles.json'), 'utf8'))
    expect(registry).toMatchObject({ version: 1, defaultAppPath: app, profiles: [entry] })
  })

  it('refuses a name longer than 200 bytes: its helper apps carry it in their file names', () => {
    expect(() =>
      createAppProfile({ name: 'w'.repeat(201), id: 'long', defaultAppPath: app, env: env(), run })
    ).toThrow('The profile name is too long: at most 200 bytes.')
    // 'é' is 2 bytes, so the limit counts bytes, not characters.
    expect(() =>
      createAppProfile({
        name: `w${'é'.repeat(100)}`,
        id: 'long',
        defaultAppPath: app,
        env: env(),
        run
      })
    ).toThrow('too long')
    const name = 'w'.repeat(200)
    const entry = createAppProfile({ name, id: 'long', defaultAppPath: app, env: env(), run })
    const helper = join(entry.appPath, 'Contents', 'Frameworks', `${name} Helper (Renderer).app`)
    expect(existsSync(helper)).toBe(true)
  })

  it('gives the next profile the next port and refuses a taken name, id or port', () => {
    createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run })
    expect(createAppProfile({ name: 'Home', defaultAppPath: app, env: env(), run }).port).toBe(6832)
    expect(() => createAppProfile({ name: 'work', defaultAppPath: app, env: env(), run })).toThrow(
      'A profile with the name "work" exists.'
    )
    expect(() =>
      createAppProfile({ name: 'Other', id: 'WORK', defaultAppPath: app, env: env(), run })
    ).toThrow('A profile with the id "WORK" exists.')
    expect(() =>
      createAppProfile({ name: 'Other', port: 6810, defaultAppPath: app, env: env(), run })
    ).toThrow('inside the port range')
    expect(() =>
      createAppProfile({ name: 'Other', port: 6790, defaultAppPath: app, env: env(), run })
    ).toThrow('inside the port range')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile refusals and failures', () => {
  it('maps `_` to `-`, so `a_b` and `a-b` cannot share a bundle id', () => {
    expect(createAppProfile({ name: 'a_b', defaultAppPath: app, env: env(), run }).bundleId).toBe(
      'com.stablyai.orca.dlux.profile.a-b'
    )
    expect(() => createAppProfile({ name: 'a-b', defaultAppPath: app, env: env(), run })).toThrow(
      'A profile with the id "a-b" exists.'
    )
  })

  it('refuses an app of that name that the registry does not know', () => {
    mkdirSync(join(dir, 'apps', 'Work.app'), { recursive: true })
    expect(() => createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run })).toThrow(
      'Work.app exists.'
    )
  })

  it('writes the marker before the app is in place', () => {
    const checking: RunTool = (program, args) => {
      if (program.endsWith('lsregister')) {
        expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
      }
      return run(program, args)
    }
    createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run: checking })
    expect(calls.some((call) => call[0].endsWith('lsregister'))).toBe(true)
  })

  it('removes the app when registration fails, so a retry works; the marker stays', () => {
    const failing: RunTool = (program, args) => {
      if (program.endsWith('lsregister')) {
        throw new Error('lsregister failed')
      }
      return run(program, args)
    }
    expect(() =>
      createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run: failing })
    ).toThrow('lsregister failed')
    expect(existsSync(join(dir, 'apps', 'Work.app'))).toBe(false)
    expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
    expect(createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run }).id).toBe('work')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile from a profile app', () => {
  it('links to the default app and keeps an inherited root out of Info.plist', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run })
    // A profile's own `orca` passes the profile app as the running app.
    const home = createAppProfile({ name: 'Home', defaultAppPath: work.appPath, env: env(), run })
    expect(home.bundleId).toBe('com.stablyai.orca.dlux.profile.home')
    expect(readlinkSync(join(home.appPath, 'Contents', 'Resources', 'app.asar.unpacked'))).toBe(
      join(realpathSync(app), 'Contents', 'Resources', 'app.asar.unpacked')
    )
    for (const entry of [work, home]) {
      const plist = join(entry.appPath, 'Contents', 'Info.plist')
      expect(plistValue(plist, 'OrcaAppProfilesRoot')).toBeNull()
    }
  })

  it('finds the default app through app.asar.unpacked: a profile has no app.asar', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run })
    expect(existsSync(join(work.appPath, 'Contents', 'Resources', 'app.asar'))).toBe(false)
    expect(defaultAppOf(work.appPath)).toBe(realpathSync(app))
  })

  it("the loader runs the default app's real app.asar with its version and name", () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run })
    // A folder stands in for the archive: plain Node reads it as Electron reads an asar.
    const asar = join(app, 'Contents', 'Resources', 'app.asar')
    rmSync(asar)
    file(join(asar, 'package.json'), '{"name":"orca","version":"9.9.9","main":"./out/main.js"}')
    file(join(asar, 'out', 'main.js'), 'globalThis.orcaLoaderTest = __filename')
    const electronApp = { setAppPath: vi.fn(), setVersion: vi.fn(), name: '' }
    const resources = join(work.appPath, 'Contents', 'Resources')
    const boot = join(resources, 'app', 'boot.js')
    const load = createRequire(boot)
    // oxlint-disable-next-line typescript/no-implied-eval -- the loader is a generated CommonJS file; this runs it with a fake electron.
    new Function('require', 'process', readFileSync(boot, 'utf8'))(
      (id: string) => (id === 'electron' ? { app: electronApp } : load(id)),
      { resourcesPath: resources }
    )
    const realAsar = join(realpathSync(app), 'Contents', 'Resources', 'app.asar')
    expect(electronApp.setAppPath).toHaveBeenCalledWith(realAsar)
    expect(electronApp.setVersion).toHaveBeenCalledWith('9.9.9')
    expect(electronApp.name).toBe('orca')
    const loaded = globalThis as typeof globalThis & { orcaLoaderTest?: string }
    expect(loaded.orcaLoaderTest).toBe(join(realAsar, 'out', 'main.js'))
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile with --id and settings', () => {
  it('uses the given id for the data folder and the bundle id, and seeds the settings', () => {
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, '{"theme":"dark"}')
    const entry = createAppProfile({
      name: 'Orca - Client',
      id: 'client',
      settingsFile: settings,
      defaultAppPath: app,
      env: env(),
      run
    })
    expect(entry).toMatchObject({
      id: 'client',
      bundleId: 'com.stablyai.orca.dlux.profile.client',
      userDataPath: join(dir, 'data', 'client')
    })
    expect(readFileSync(join(entry.userDataPath, 'orca-settings-seed.json'), 'utf8')).toBe(
      '{"theme":"dark"}'
    )
  })

  it('refuses an id that is not valid or is reserved', () => {
    expect(() =>
      createAppProfile({ name: 'A', id: 'a_b', defaultAppPath: app, env: env(), run })
    ).toThrow('letters, digits and -')
    expect(() =>
      createAppProfile({ name: 'A', id: 'Manager', defaultAppPath: app, env: env(), run })
    ).toThrow('reserved')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile on kept data', () => {
  it('adopts the data folder that a removal with "Keep data" left for this id', () => {
    const userDataPath = join(dir, 'data', 'work')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'orca-app-profile.json'), '{"id":"work"}\n')
    writeFileSync(join(userDataPath, 'orca-data.json'), 'old chats')
    const entry = createAppProfile({
      name: 'Job',
      id: 'work',
      defaultAppPath: app,
      env: env(),
      run
    })
    expect(entry).toMatchObject({ id: 'work', userDataPath, adoptedData: true })
    expect(readFileSync(join(userDataPath, 'orca-data.json'), 'utf8')).toBe('old chats')
    expect(
      createAppProfile({ name: 'Home', defaultAppPath: app, env: env(), run }).adoptedData
    ).toBe(false)
  })

  it('refuses a data folder whose marker names another profile', () => {
    const userDataPath = join(dir, 'data', 'work')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'orca-app-profile.json'), '{"id":"Work"}\n')
    expect(() =>
      createAppProfile({ name: 'Job', id: 'work', defaultAppPath: app, env: env(), run })
    ).toThrow('is the data folder of the profile "Work"')
    expect(existsSync(join(dir, 'apps', 'Job.app'))).toBe(false)
  })
})

describe.skipIf(process.platform !== 'darwin')(
  'createAppProfile refuses a data folder that is not its own',
  () => {
    const create = (id: string) =>
      createAppProfile({ name: 'Job', id, defaultAppPath: app, env: env(), run })

    it('refuses a folder without a marker, also under another case of the id', () => {
      mkdirSync(join(dir, 'data', 'work'), { recursive: true })
      writeFileSync(join(dir, 'data', 'work', 'notes.txt'), 'mine')
      expect(() => create('work')).toThrow('has no profile marker')
      expect(() => create('Work')).toThrow('has no profile marker')
      expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(false)
      expect(existsSync(join(dir, 'apps', 'Job.app'))).toBe(false)
    })

    it('refuses a link, also a link to a folder with the right marker', () => {
      const outside = join(dir, 'outside')
      mkdirSync(outside)
      writeFileSync(join(outside, 'orca-app-profile.json'), '{"id":"work"}')
      mkdirSync(join(dir, 'data'), { recursive: true })
      symlinkSync(outside, join(dir, 'data', 'work'))
      expect(() => create('work')).toThrow('is not a profile data folder')
    })

    it("refuses the default app's data folder", () => {
      const appSupport = join(dir, 'Library', 'Application Support')
      mkdirSync(join(appSupport, 'orca'), { recursive: true })
      expect(() =>
        createAppProfile({
          name: 'Job',
          id: 'orca',
          defaultAppPath: app,
          env: { ...env(), ORCA_PROFILES_ROOT: appSupport },
          home: dir,
          run
        })
      ).toThrow("is the default app's data")
    })

    it('removes a seed that kept data holds when this create copies no settings', () => {
      const userDataPath = join(dir, 'data', 'work')
      mkdirSync(userDataPath, { recursive: true })
      writeFileSync(join(userDataPath, 'orca-app-profile.json'), '{"id":"work"}')
      writeFileSync(join(userDataPath, 'orca-settings-seed.json'), '{"theme":"dark"}')
      create('work')
      expect(existsSync(join(userDataPath, 'orca-settings-seed.json'))).toBe(false)
    })
  }
)
