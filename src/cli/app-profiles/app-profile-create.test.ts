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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAppProfile,
  nextAppProfilePort,
  runProfilesCreate,
  type RunTool
} from './app-profile-create'
import { setAppProfileIcon } from './app-profile-set-icon'
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
    if (args[0] === '--force' && target.endsWith('.app')) {
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
  file(
    join(contents, 'Frameworks', 'Orca Helper (Renderer).app', 'Contents', 'MacOS', 'h'),
    'helper'
  )
  file(join(contents, 'Frameworks', 'Squirrel.framework', 'Versions', 'A', 'y'), 'squirrel')
  file(join(contents, 'Resources', 'app.asar'), 'asar')
  file(join(contents, 'Resources', 'icon.icns'), 'default icon')
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
    const entry = createAppProfile({
      name: 'Orca - Work',
      defaultAppPath: app,
      env: env(),
      run,
      makeIcon,
      now: () => 1,
      pinRoot: true
    })
    const contents = join(entry.appPath, 'Contents')
    expect(entry).toEqual({
      id: 'orca-work',
      name: 'Orca - Work',
      bundleId: 'com.stablyai.orca.dlux.profile.orca-work',
      appPath: join(dir, 'apps', 'Orca - Work.app'),
      userDataPath: join(dir, 'data', 'orca-work'),
      port: 6800,
      icon: { kind: 'badge', text: '2', style: 'ref-match' },
      createdAt: 1
    })
    const isLink = (path: string): boolean => lstatSync(path).isSymbolicLink()
    expect(isLink(join(contents, 'MacOS', 'Orca'))).toBe(false)
    expect(lstatSync(join(contents, 'MacOS', 'Orca')).mode & 0o111).not.toBe(0)
    expect(readFileSync(join(contents, 'MacOS', 'orca-notification-status'), 'utf8')).toBe(
      'profile variant'
    )
    expect(isLink(join(contents, 'Frameworks', 'Orca Helper (Renderer).app'))).toBe(false)
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
    // The icon is the profile's own file; userData keeps a copy under the profile id.
    expect(isLink(join(contents, 'Resources', 'icon.icns'))).toBe(false)
    expect(readFileSync(join(contents, 'Resources', 'icon.icns'), 'utf8')).toBe('icns 2')
    expect(readFileSync(join(entry.userDataPath, 'profile-icon.icns'), 'utf8')).toBe('icns 2')
    expect(readlinkSync(join(contents, 'Resources', 'app.asar'))).toBe(
      join(app, 'Contents', 'Resources', 'app.asar')
    )

    const plist = join(contents, 'Info.plist')
    expect(plistValue(plist, 'CFBundleIdentifier')).toBe(entry.bundleId)
    expect(plistValue(plist, 'CFBundleDisplayName')).toBe('Orca - Work')
    expect(plistValue(plist, 'CFBundleName')).toBe('Orca')
    expect(plistValue(plist, 'OrcaAppProfileId')).toBe('orca-work')
    expect(plistValue(plist, 'OrcaAppProfilesRoot')).toBe(join(dir, 'data'))
    expect(plistValue(plist, 'CFBundleURLTypes')).toBeNull()
    expect(plistValue(plist, 'ElectronAsarIntegrity')).toBeNull()
    expect(plistValue(plist, 'CFBundleDocumentTypes.0.CFBundleTypeRole')).toBe('Editor')

    // Small executables first, then the bundle; ad hoc, no --deep, no hardened runtime.
    const signs = calls.filter((call) => call[0].endsWith('codesign') && call[1] === '--force')
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
      id: 'orca-work'
    })
    const registry = JSON.parse(readFileSync(join(dir, 'data', 'profiles.json'), 'utf8'))
    expect(registry).toMatchObject({ version: 1, defaultAppPath: app, profiles: [entry] })
  })

  it('gives the next profile the next port and badge, and refuses a taken id or port', () => {
    createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    expect(
      createAppProfile({ name: 'Home', defaultAppPath: app, env: env(), run, makeIcon }).port
    ).toBe(6832)
    expect(iconSources).toEqual([
      { kind: 'badge', text: '2' },
      { kind: 'badge', text: '3' }
    ])
    expect(() =>
      createAppProfile({ name: 'work', defaultAppPath: app, env: env(), run, makeIcon })
    ).toThrow('The profile "work" exists.')
    expect(() =>
      createAppProfile({
        name: 'Other',
        port: 6810,
        defaultAppPath: app,
        env: env(),
        run,
        makeIcon
      })
    ).toThrow('inside the port range')
    expect(() =>
      createAppProfile({
        name: 'Other',
        port: 6790,
        defaultAppPath: app,
        env: env(),
        run,
        makeIcon
      })
    ).toThrow('inside the port range')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile refusals and failures', () => {
  it('maps `_` to `-`, so `a_b` and `a-b` cannot share a bundle id', () => {
    expect(
      createAppProfile({ name: 'a_b', defaultAppPath: app, env: env(), run, makeIcon }).bundleId
    ).toBe('com.stablyai.orca.dlux.profile.a-b')
    expect(() =>
      createAppProfile({ name: 'a-b', defaultAppPath: app, env: env(), run, makeIcon })
    ).toThrow('The profile "a-b" exists.')
  })

  it('refuses an app of that name that the registry does not know', () => {
    mkdirSync(join(dir, 'apps', 'Work.app'), { recursive: true })
    expect(() =>
      createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    ).toThrow('Work.app exists.')
  })

  it('writes the marker before the app is in place', () => {
    const checking: RunTool = (program, args) => {
      if (program.endsWith('lsregister')) {
        expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
      }
      return run(program, args)
    }
    createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run: checking, makeIcon })
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
      createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run: failing, makeIcon })
    ).toThrow('lsregister failed')
    expect(existsSync(join(dir, 'apps', 'Work.app'))).toBe(false)
    expect(existsSync(join(dir, 'data', 'work', 'orca-app-profile.json'))).toBe(true)
    expect(
      createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon }).id
    ).toBe('work')
  })
})

describe.skipIf(process.platform !== 'darwin')('createAppProfile from a profile app', () => {
  it('links to the default app and keeps an inherited root out of Info.plist', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    // A profile's own `orca` passes the profile app as the running app.
    const home = createAppProfile({
      name: 'Home',
      defaultAppPath: work.appPath,
      env: env(),
      run,
      makeIcon
    })
    expect(home.bundleId).toBe('com.stablyai.orca.dlux.profile.home')
    expect(readlinkSync(join(home.appPath, 'Contents', 'Resources', 'app.asar'))).toBe(
      join(realpathSync(app), 'Contents', 'Resources', 'app.asar')
    )
    for (const entry of [work, home]) {
      const plist = join(entry.appPath, 'Contents', 'Info.plist')
      expect(plistValue(plist, 'OrcaAppProfilesRoot')).toBeNull()
    }
  })
})

describe.skipIf(process.platform !== 'darwin')('setAppProfileIcon', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  const icon = (entry: { appPath: string }): string => bundleIcon(entry.appPath)
  const defaultIcon = (): string => join(app, 'Contents', 'Resources', 'icon.icns')
  // A profile made before icons has a link to the default app's icon.
  const linkIcon = (entry: { appPath: string }): void => {
    rmSync(icon(entry))
    symlinkSync(defaultIcon(), icon(entry))
  }

  it('writes the icon by profile id, signs again, registers again and records it', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    createAppProfile({ name: 'Home', defaultAppPath: app, env: env(), run, makeIcon })
    linkIcon(work)
    calls = []
    // The automatic character skips the badges of the other profiles, not the own one.
    const changed = setAppProfileIcon('work', { kind: 'badge' }, { env: env(), run, makeIcon })
    expect(changed.icon).toEqual({ kind: 'badge', text: '2', style: 'ref-match' })
    setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, { env: env(), run, makeIcon })
    expect(lstatSync(icon(work)).isSymbolicLink()).toBe(false)
    expect(read(icon(work))).toBe('icns Q')
    expect(read(defaultIcon())).toBe('default icon')
    expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns Q')
    expect(calls.slice(-3)).toEqual([
      ['/usr/bin/codesign', '-d', '--entitlements', '-', '--xml', app],
      [
        '/usr/bin/codesign',
        '--force',
        '-s',
        '-',
        '-i',
        work.bundleId,
        '--entitlements',
        expect.stringMatching(/entitlements\.plist$/),
        work.appPath
      ],
      [expect.stringMatching(/lsregister$/), '-f', work.appPath]
    ])
    const registry = JSON.parse(read(join(dir, 'data', 'profiles.json')))
    expect(registry.profiles.map((p: { icon: { text: string } }) => p.icon.text)).toEqual([
      'Q',
      '3'
    ])
  })

  it('gives each new icon a new file name, so that macOS does not show a cached icon', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const resources = join(work.appPath, 'Contents', 'Resources')
    setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, { env: env(), run, makeIcon })
    const first = icon(work)
    expect(first).toMatch(/\/icon-[0-9a-f]{8}\.icns$/)
    expect(existsSync(join(resources, 'icon.icns'))).toBe(false)
    setAppProfileIcon('work', { kind: 'badge', text: 'R' }, { env: env(), run, makeIcon })
    expect(icon(work)).not.toBe(first)
    expect(existsSync(first)).toBe(false)
    expect(read(icon(work))).toBe('icns R')
  })

  it('keeps an uploaded badge as PNG, so that the Edit form can start from it', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const badge = join(work.userDataPath, 'profile-icon-badge.png')
    // The source can be the kept badge itself: its bytes are read before the write.
    const imageIcon = ((_app: string, source: { path: string }) => ({
      icns: Buffer.from('icns image'),
      icon: { kind: 'image', style: 'ref-match' },
      badgePng: Buffer.from(`png of ${readFileSync(source.path, 'utf8')}`)
    })) as never
    writeFileSync(join(dir, 'logo.svg'), 'logo')
    setAppProfileIcon(
      'work',
      { kind: 'image', path: join(dir, 'logo.svg') },
      { env: env(), run, makeIcon: imageIcon }
    )
    expect(read(badge)).toBe('png of logo')
    setAppProfileIcon(
      'work',
      { kind: 'image', path: badge },
      { env: env(), run, makeIcon: imageIcon }
    )
    expect(read(badge)).toBe('png of png of logo')
    // A badge character has no badge image.
    setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, { env: env(), run, makeIcon })
    expect(existsSync(badge)).toBe(false)
  })

  it('refuses an unknown id and a profile that runs', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    expect(() =>
      setAppProfileIcon('home', { kind: 'badge' }, { env: env(), run, makeIcon })
    ).toThrow('No profile "home".')
    writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
    expect(() =>
      setAppProfileIcon('work', { kind: 'badge', text: 'Q' }, { env: env(), run, makeIcon })
    ).toThrow('"Work" runs.')
    expect(read(icon(work))).toBe('icns 2')
  })

  it('refuses when the app starts while the icon is made', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const starting = ((...args: unknown[]) => {
      writeFileSync(getRuntimeMetadataPath(work.userDataPath), JSON.stringify({ pid: process.pid }))
      return (makeIcon as (...a: unknown[]) => unknown)(...args)
    }) as never
    expect(() =>
      setAppProfileIcon(
        'work',
        { kind: 'badge', text: 'Q' },
        { env: env(), run, makeIcon: starting }
      )
    ).toThrow('"Work" runs.')
    expect(read(icon(work))).toBe('icns 2')
  })

  it('puts the old icon back and records nothing when codesign fails', () => {
    const work = createAppProfile({ name: 'Work', defaultAppPath: app, env: env(), run, makeIcon })
    const failing: RunTool = (program, args) => {
      if (program.endsWith('codesign') && args[0] === '--force') {
        throw new Error('codesign failed')
      }
      return run(program, args)
    }
    for (const before of ['file', 'link']) {
      if (before === 'link') {
        linkIcon(work)
      }
      expect(() =>
        setAppProfileIcon(
          'work',
          { kind: 'badge', text: 'Q' },
          { env: env(), run: failing, makeIcon }
        )
      ).toThrow('codesign failed')
      expect(lstatSync(icon(work)).isSymbolicLink()).toBe(before === 'link')
      expect(read(icon(work))).toBe(before === 'link' ? 'default icon' : 'icns 2')
      expect(read(defaultIcon())).toBe('default icon')
      expect(read(join(work.userDataPath, 'profile-icon.icns'))).toBe('icns 2')
      const registry = JSON.parse(read(join(dir, 'data', 'profiles.json')))
      expect(registry.profiles[0].icon.text).toBe('2')
    }
  })
})

describe('runProfilesCreate', () => {
  it('refuses icon flags that do not go together, and unknown flags', () => {
    expect(() => runProfilesCreate(['Work', '--icon-badge', 'Q', '--icon-file', 'a.icns'])).toThrow(
      'Use only one'
    )
    expect(() => runProfilesCreate(['Work', '--icon-color', 'red'])).toThrow('Usage:')
  })
})

describe('nextAppProfilePort', () => {
  it('skips the ports of other profiles', () => {
    const profile = (port: number) => ({ port }) as never
    expect(nextAppProfilePort([])).toBe(6800)
    expect(nextAppProfilePort([profile(6800), profile(6864)])).toBe(6832)
    expect(nextAppProfilePort([profile(6801)])).toBe(6864)
  })
})
