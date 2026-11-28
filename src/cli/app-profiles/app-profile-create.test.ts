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
import {
  setAppProfileIcon,
  setDefaultAppIcon,
  type SetAppProfileIconOptions
} from './app-profile-set-icon'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import { appIconFileName, nextBadgeText } from './app-profile-icon'

const DEFAULT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux</string>
  <key>CFBundleExecutable</key><string>Orca</string>
  <key>CFBundleName</key><string>Orca</string>
  <key>CFBundleDisplayName</key><string>Orca</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>orca</string></array></dict></array>
  <key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeRole</key><string>Editor</string></dict></array>
  <key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict/></dict>
</dict>
</plist>
`

let dir: string
let app: string
let calls: string[][]
let iconSources: unknown[]
let customIcons: [string, string][]

// The icon file that the bundle's Info.plist names.
const bundleIcon = (appPath: string): string =>
  join(
    appPath,
    'Contents',
    'Resources',
    appIconFileName(readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8'))
  )

// The real icon takes seconds to render; its own tests cover it.
const makeIcon = ((
  _app: string,
  source: { kind: string; text?: string },
  used: Parameters<typeof nextBadgeText>[0]
) => {
  const text = source.text ?? nextBadgeText(used)
  iconSources.push({ ...source, text })
  return { icns: Buffer.from(`icns ${text}`), icon: { kind: 'badge', text, style: 'ref-match' } }
}) as never

// Real ditto and plutil; codesign and lsregister are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('codesign')) {
    const target = args.at(-1) ?? ''
    // The seal must cover the new icon: a real file with the new bytes when the bundle is signed.
    // The seal of the profile bundle, not of a helper app inside it.
    if (args[0] === '--force' && target.endsWith('.app') && !target.includes('/Frameworks/')) {
      const icon = bundleIcon(target)
      if (lstatSync(icon).isSymbolicLink() || !readFileSync(icon, 'utf8').startsWith('icns ')) {
        throw new Error(`codesign before the icon is written: ${icon}`)
      }
    }
    return args[0] === '-d' ? '<plist><dict/></plist>' : ''
  }
  if (program.endsWith('lsregister')) {
    return ''
  }
  if (program === '/usr/bin/env') {
    // The Finder custom icon: record the bundle and the icon file content at that time.
    const value = (name: string): string =>
      (args.find((arg) => arg.startsWith(`${name}=`)) ?? '').slice(name.length + 1)
    customIcons.push([
      value('ORCA_APP_BUNDLE_PATH'),
      readFileSync(value('ORCA_APP_ICON_PATH'), 'utf8')
    ])
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
  customIcons = []
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
  file(join(contents, 'Resources', 'icon.icns'), 'default icon')
  file(join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js'), 'cli')
  file(
    join(contents, 'Resources', 'profile-template', 'orca-notification-status'),
    'profile variant'
  )
  calls = []
  iconSources = []
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
      makeIcon,
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
      icon: { kind: 'badge', text: 'W', style: 'ref-match' },
      createdAt: 1
    })
    const isLink = (path: string): boolean => lstatSync(path).isSymbolicLink()
    // The icon is the profile's own file; userData keeps a copy under the profile id.
    expect(isLink(join(contents, 'Resources', 'icon.icns'))).toBe(false)
    expect(readFileSync(join(contents, 'Resources', 'icon.icns'), 'utf8')).toBe('icns W')
    expect(readFileSync(join(entry.userDataPath, 'profile-icon.icns'), 'utf8')).toBe('icns W')
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
      createAppProfile({
        name: 'w'.repeat(201),
        id: 'long',
        defaultAppPath: app,
        env: env(),
        run,
        makeIcon
      })
    ).toThrow('The profile name is too long: at most 200 bytes.')
    // 'é' is 2 bytes, so the limit counts bytes, not characters.
    expect(() =>
      createAppProfile({
        name: `w${'é'.repeat(100)}`,
        id: 'long',
        defaultAppPath: app,
        env: env(),
        run,
        makeIcon
      })
    ).toThrow('too long')
    const name = 'w'.repeat(200)
    const entry = createAppProfile({
      name,
      id: 'long',
      defaultAppPath: app,
      env: env(),
      run,
      makeIcon
    })
    const helper = join(entry.appPath, 'Contents', 'Frameworks', `${name} Helper (Renderer).app`)
    expect(existsSync(helper)).toBe(true)
  })

  it('gives the next profile the next port and the badge of its name, and refuses a taken name, id or port', () => {
    createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run })
    expect(
      createAppProfile({ makeIcon, name: 'Home', defaultAppPath: app, env: env(), run }).port
    ).toBe(6832)
    // "W" is taken: the first free character. Explicit flags stay as they are.
    createAppProfile({ name: 'Wild', defaultAppPath: app, env: env(), run, makeIcon })
    createAppProfile({
      name: 'Blue',
      icon: { kind: 'badge', text: 'Q' },
      defaultAppPath: app,
      env: env(),
      run,
      makeIcon
    })
    expect(iconSources).toEqual([
      { kind: 'badge', text: 'W', color: '#9333ea' },
      { kind: 'badge', text: 'H', color: '#2563eb' },
      { kind: 'badge', text: '2', color: '#dc2626' },
      { kind: 'badge', text: 'Q' }
    ])
    expect(() =>
      createAppProfile({ makeIcon, name: 'work', defaultAppPath: app, env: env(), run })
    ).toThrow('A profile with the name "work" exists.')
    expect(() =>
      createAppProfile({
        makeIcon,
        name: 'Other',
        id: 'WORK',
        defaultAppPath: app,
        env: env(),
        run
      })
    ).toThrow('A profile with the id "WORK" exists.')
    expect(() =>
      createAppProfile({
        makeIcon,
        name: 'Other',
        port: 6810,
        defaultAppPath: app,
        env: env(),
        run
      })
    ).toThrow('inside the port range')
    expect(() =>
      createAppProfile({
        makeIcon,
        name: 'Other',
        port: 6790,
        defaultAppPath: app,
        env: env(),
        run
      })
    ).toThrow('inside the port range')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile refusals and failures', () => {
  it('maps `_` to `-`, so `a_b` and `a-b` cannot share a bundle id', () => {
    expect(
      createAppProfile({ makeIcon, name: 'a_b', defaultAppPath: app, env: env(), run }).bundleId
    ).toBe('com.stablyai.orca.dlux.profile.a-b')
    expect(() =>
      createAppProfile({ makeIcon, name: 'a-b', defaultAppPath: app, env: env(), run })
    ).toThrow('A profile with the id "a-b" exists.')
  })

  it('refuses an app of that name that the registry does not know', () => {
    mkdirSync(join(dir, 'apps', 'Work.app'), { recursive: true })
    expect(() =>
      createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run })
    ).toThrow('Work.app exists.')
  })

  it('writes the marker before the app is in place', () => {
    const checking: RunTool = (program, args) => {
      if (program.endsWith('lsregister')) {
        expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
      }
      return run(program, args)
    }
    createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run: checking })
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
      createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run: failing })
    ).toThrow('lsregister failed')
    expect(existsSync(join(dir, 'apps', 'Work.app'))).toBe(false)
    expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
    expect(
      createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run }).id
    ).toBe('work')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile from a profile app', () => {
  it('links to the default app and keeps an inherited root out of Info.plist', () => {
    const work = createAppProfile({ makeIcon, name: 'Work', defaultAppPath: app, env: env(), run })
    // A profile's own `orca` passes the profile app as the running app.
    const home = createAppProfile({
      makeIcon,
      name: 'Home',
      defaultAppPath: work.appPath,
      env: env(),
      run
    })
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
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    expect(existsSync(join(work.appPath, 'Contents', 'Resources', 'app.asar'))).toBe(false)
    expect(defaultAppOf(work.appPath)).toBe(realpathSync(app))
  })

  it("the loader runs the default app's real app.asar with its version and name", () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
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
    expect(Reflect.get(globalThis, 'orcaLoaderTest')).toBe(join(realAsar, 'out', 'main.js'))
  })
})

describe.skipIf(process.platform !== 'darwin')(
  'createAppProfile from the Profile Manager app',
  () => {
    it("takes the default app through the Manager app's relative links", () => {
      // The release layout: <default app>/Contents/Applications/<Manager>.app, links to ../../../../.
      const manager = join(app, 'Contents', 'Applications', 'Orca Profile Manager.app')
      const contents = join(manager, 'Contents')
      file(
        join(contents, 'Info.plist'),
        DEFAULT_PLIST.replace(
          'com.stablyai.orca.dlux</string>',
          'com.stablyai.orca.dlux.profile-manager</string>\n  <key>OrcaAppRole</key><string>profile-manager</string>'
        )
      )
      mkdirSync(join(contents, 'Resources'), { recursive: true })
      // The Manager's app.asar is a copy (Electron 45 reads no asar through a link).
      writeFileSync(join(contents, 'Resources', 'app.asar'), 'asar copy')
      symlinkSync(
        join('..', '..', '..', '..', 'Resources', 'app.asar.unpacked'),
        join(contents, 'Resources', 'app.asar.unpacked')
      )
      const work = createAppProfile({
        makeIcon,
        name: 'Work',
        defaultAppPath: manager,
        env: env(),
        run
      })
      expect(work.bundleId).toBe('com.stablyai.orca.dlux.profile.work')
      expect(readlinkSync(join(work.appPath, 'Contents', 'Resources', 'app.asar.unpacked'))).toBe(
        join(realpathSync(app), 'Contents', 'Resources', 'app.asar.unpacked')
      )
    })
  }
)

describe.skipIf(process.platform !== 'darwin')('defaultAppOf', () => {
  it('takes the outer app for a Manager app at the nested place without its role', () => {
    const manager = join(app, 'Contents', 'Applications', 'Orca Profile Manager.app')
    const contents = join(manager, 'Contents')
    // The default plist: no OrcaAppRole, as after a plist miss.
    file(join(contents, 'Info.plist'), DEFAULT_PLIST)
    mkdirSync(join(contents, 'Resources'), { recursive: true })
    // The Manager's app.asar is a copy (Electron 45 reads no asar through a link).
    writeFileSync(join(contents, 'Resources', 'app.asar'), 'asar copy')
    symlinkSync(
      join('..', '..', '..', '..', 'Resources', 'app.asar.unpacked'),
      join(contents, 'Resources', 'app.asar.unpacked')
    )
    expect(defaultAppOf(manager)).toBe(realpathSync(app))
    expect(defaultAppOf(app)).toBe(app)
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile with --id and settings', () => {
  it('uses the given id for the data folder and the bundle id, and seeds the settings', () => {
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, '{"theme":"dark"}')
    const entry = createAppProfile({
      makeIcon,
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
      createAppProfile({ makeIcon, name: 'A', id: 'a_b', defaultAppPath: app, env: env(), run })
    ).toThrow('letters, digits and -')
    expect(() =>
      createAppProfile({ makeIcon, name: 'A', id: 'Manager', defaultAppPath: app, env: env(), run })
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
      makeIcon,
      name: 'Job',
      id: 'work',
      defaultAppPath: app,
      env: env(),
      run
    })
    expect(entry).toMatchObject({ id: 'work', userDataPath, adoptedData: true })
    expect(readFileSync(join(userDataPath, 'orca-data.json'), 'utf8')).toBe('old chats')
    expect(
      createAppProfile({ makeIcon, name: 'Home', defaultAppPath: app, env: env(), run }).adoptedData
    ).toBe(false)
  })

  it('refuses a data folder whose marker names another profile', () => {
    const userDataPath = join(dir, 'data', 'work')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'orca-app-profile.json'), '{"id":"Work"}\n')
    expect(() =>
      createAppProfile({ makeIcon, name: 'Job', id: 'work', defaultAppPath: app, env: env(), run })
    ).toThrow('is the data folder of the profile "Work"')
    expect(existsSync(join(dir, 'apps', 'Job.app'))).toBe(false)
  })
})

describe.skipIf(process.platform !== 'darwin')(
  'createAppProfile refuses a data folder that is not its own',
  () => {
    const create = (id: string) =>
      createAppProfile({ makeIcon, name: 'Job', id, defaultAppPath: app, env: env(), run })

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
          makeIcon,
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

    it('replaces a link at the icon copy of kept data, and leaves its target alone', () => {
      const userDataPath = join(dir, 'data', 'work')
      mkdirSync(userDataPath, { recursive: true })
      writeFileSync(join(userDataPath, 'orca-app-profile.json'), '{"id":"work"}')
      const outside = join(dir, 'outside.txt')
      writeFileSync(outside, 'outside')
      symlinkSync(outside, join(userDataPath, 'profile-icon.icns'))
      create('work')
      expect(readFileSync(outside, 'utf8')).toBe('outside')
      expect(lstatSync(join(userDataPath, 'profile-icon.icns')).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(userDataPath, 'profile-icon.icns'), 'utf8')).toBe('icns J')
    })
  }
)

describe.skipIf(process.platform !== 'darwin')('setAppProfileIcon', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')
  // No serve service runs.
  const opts = (more: Partial<SetAppProfileIconOptions> = {}): SetAppProfileIconOptions => ({
    env: env(),
    home: dir,
    uid: 501,
    run,
    makeIcon,
    serviceRun: async () => ({ code: 113, out: 'Could not find service' }),
    ...more
  })

  const icon = (entry: { appPath: string }): string => bundleIcon(entry.appPath)
  const signed = (entry: { appPath: string }): string[] => [
    read(join(entry.appPath, 'Contents', 'Info.plist')),
    read(icon(entry))
  ]

  it('sets a Finder custom icon by profile id and records it; the signed bundle stays as it is', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    createAppProfile({ name: 'Home', defaultAppPath: app, env: env(), run, makeIcon })
    const before = signed(work)
    calls = []
    // The automatic character skips the badges of the other profiles, not the own one.
    const changed = await setAppProfileIcon('work', { kind: 'badge' }, opts())
    expect(changed.icon).toEqual({ kind: 'badge', text: 'W', style: 'ref-match' })
    await setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts())
    expect(customIcons).toEqual([
      [work.appPath, 'icns W'],
      [work.appPath, 'icns Q']
    ])
    expect(calls.filter(([program]) => /codesign|lsregister/.test(program))).toEqual([])
    expect(calls.find(([program]) => program === '/usr/bin/env')).toContain('/usr/bin/osascript')
    expect(signed(work)).toEqual(before)
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns Q')
    const registry = JSON.parse(read(join(dir, 'data', 'profiles.json')))
    expect(registry.profiles.map((p: { icon: { text: string } }) => p.icon.text)).toEqual([
      'Q',
      'H'
    ])
  })

  it('keeps an uploaded badge as PNG, so that the Edit form can start from it', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const badge = join(work.userDataPath, 'profile-icon-badge.png')
    // The source can be the kept badge itself: its bytes are read before the write.
    const imageIcon = ((_app: string, source: { path: string }) => ({
      icns: Buffer.from('icns image'),
      icon: { kind: 'image', style: 'ref-match' },
      badgePng: Buffer.from(`png of ${readFileSync(source.path, 'utf8')}`)
    })) as never
    writeFileSync(join(dir, 'logo.svg'), 'logo')
    const image = (path: string) => ({ kind: 'image' as const, path })
    await setAppProfileIcon('work', image(join(dir, 'logo.svg')), opts({ makeIcon: imageIcon }))
    expect(read(badge)).toBe('png of logo')
    await setAppProfileIcon('work', image(badge), opts({ makeIcon: imageIcon }))
    expect(read(badge)).toBe('png of png of logo')
    // A badge character has no badge image.
    await setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts())
    expect(existsSync(badge)).toBe(false)
  })

  it('refuses an unknown id and a profile that runs', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    customIcons = []
    await expect(setAppProfileIcon('home', { kind: 'badge' }, opts())).rejects.toThrow(
      'No profile "home".'
    )
    writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
    await expect(setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts())).rejects.toThrow(
      '"Work" runs.'
    )
    // set-icon writes the kept copy and the Finder custom icon; the signed bundle never changes.
    expect(customIcons).toEqual([])
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns W')
  })

  it('with whileRunning, changes the icon of the running profile app (its own Settings)', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
    const changed = await setAppProfileIcon(
      'work',
      { kind: 'badge', text: 'Q' },
      opts({ whileRunning: true })
    )
    expect(changed.icon).toMatchObject({ kind: 'badge', text: 'Q' })
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns Q')
  })

  it('keeps the default app icon in its userData and profiles.json; no badge removes both', async () => {
    const userData = join(dir, 'default-data')
    mkdirSync(userData)
    const options = {
      env: env(),
      home: dir,
      makeIcon,
      defaultAppPath: app,
      defaultUserDataPath: userData
    }
    // No profile yet: the first default icon makes profiles.json.
    const made = await setDefaultAppIcon({ kind: 'badge', text: 'D' }, options)
    expect(made).toEqual({ id: 'default', icon: { kind: 'badge', text: 'D', style: 'ref-match' } })
    expect(read(join(userData, 'profile-icon.icns'))).toBe('icns D')
    const registryPath = join(dir, 'data', 'profiles.json')
    expect(JSON.parse(read(registryPath))).toMatchObject({
      defaultAppPath: app,
      profiles: [],
      defaultIcon: { kind: 'badge', text: 'D' }
    })
    // A profile made after it keeps the default icon in profiles.json.
    createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    expect(JSON.parse(read(registryPath)).defaultIcon).toMatchObject({ text: 'D' })
    // The default app needs no Finder icon: it shows the kept one itself.
    expect(customIcons).toEqual([])
    expect(await setDefaultAppIcon({ kind: 'none', base: 'blue' }, options)).toEqual({
      id: 'default'
    })
    expect(existsSync(join(userData, 'profile-icon.icns'))).toBe(false)
    expect(JSON.parse(read(registryPath)).defaultIcon).toBeUndefined()
    expect(JSON.parse(read(registryPath)).profiles).toHaveLength(1)
  })

  it('replaces a link at the icon copy in the data folder, and leaves its target alone', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, 'outside')
    rmSync(join(work.userDataPath, 'profile-icon.icns'))
    symlinkSync(outside, join(work.userDataPath, 'profile-icon.icns'))
    await setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts())
    expect(read(outside)).toBe('outside')
    expect(lstatSync(join(work.userDataPath, 'profile-icon.icns')).isSymbolicLink()).toBe(false)
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns Q')
  })

  it('refuses when the app starts while the icon is made', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    customIcons = []
    const starting = ((...args: unknown[]) => {
      writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
      return (makeIcon as (...a: unknown[]) => unknown)(...args)
    }) as never
    await expect(
      setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts({ makeIcon: starting }))
    ).rejects.toThrow('"Work" runs.')
    // set-icon writes the kept copy and the Finder custom icon; the signed bundle never changes.
    expect(customIcons).toEqual([])
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns W')
  })

  it('with ifMissing, gives a profile without an icon its name badge once, also while it runs', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    customIcons = []
    // A profile from a build before profile icons: no icon in profiles.json.
    const registryPath = join(dir, 'data', 'profiles.json')
    const registry = JSON.parse(read(registryPath))
    delete registry.profiles[0].icon
    writeFileSync(registryPath, JSON.stringify(registry))
    writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
    const options = opts({ ifMissing: true })
    expect((await setAppProfileIcon('work', { kind: 'badge' }, options)).icon).toEqual({
      kind: 'badge',
      text: 'W',
      style: 'ref-match'
    })
    // It has an icon now: nothing changes.
    const again = await setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, options)
    expect(again.icon).toMatchObject({ text: 'W' })
    expect(customIcons).toEqual([[work.appPath, 'icns W']])
  })

  it('changes nothing when macOS refuses the custom icon', async () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const failing: RunTool = (program, args) => {
      if (program === '/usr/bin/env') {
        throw new Error('setIcon failed')
      }
      return run(program, args)
    }
    await expect(
      setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, opts({ run: failing }))
    ).rejects.toThrow('setIcon failed')
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns W')
    const registry = JSON.parse(read(join(dir, 'data', 'profiles.json')))
    expect(registry.profiles[0].icon.text).toBe('W')
  })
})
