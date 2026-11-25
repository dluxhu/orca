import { execFileSync } from 'node:child_process'
import type * as Fs from 'node:fs'
import {
  utimesSync,
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
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ failSwap: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof Fs>()
  return {
    ...fs,
    // The second rename of the swap: the new bundle into the app's place.
    renameSync: (from: Fs.PathLike, to: Fs.PathLike) => {
      if (
        h.failSwap &&
        String(from).includes('.refresh-') &&
        String(to).endsWith('/apps/Work.app')
      ) {
        throw new Error('rename failed')
      }
      return fs.renameSync(from, to)
    }
  }
})

import {
  preRefreshPathOf,
  refreshAppProfileBundle,
  removePreRefreshLeftovers,
  settlePreRefresh
} from './app-profile-bundle-refresh'
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
/** Each signed path, its entitlements, and whether it had Finder information at that time. */
let signed: { path: string; entitlements: string | null; finderInfo: boolean }[]

const FINDER_INFO = '0000000000000000040000000000000000000000000000000000000000000000'
const finderInfoOf = (path: string): string =>
  execFileSync(
    '/bin/sh',
    ['-c', '/usr/bin/xattr -px com.apple.FinderInfo "$0" 2>/dev/null || true', path],
    {
      encoding: 'utf8'
    }
  ).replace(/\s+/g, '')

// Real ditto, cp, plutil and xattr; codesign and lsregister are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('codesign')) {
    if (args[0] === '-d') {
      // Each helper has its own entitlements; the renderer has JIT.
      const of = args.at(-1) ?? ''
      return `<plist>${basename(of)}${of.includes('(Renderer)') ? ' allow-jit' : ''}</plist>`
    }
    if (failSign && args[0] === '--force') {
      throw new Error('codesign failed')
    }
    const at = args.indexOf('--entitlements')
    const path = args.at(-1) ?? ''
    signed.push({
      path,
      entitlements: at === -1 ? null : readFileSync(args[at + 1], 'utf8'),
      finderInfo: finderInfoOf(path) !== ''
    })
    return ''
  }
  if (program.endsWith('lsregister')) {
    return ''
  }
  // The Finder custom icon (AppKit through osascript) never runs in a test.
  if (program === '/usr/bin/env') {
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
  for (const type of ['', ' (Renderer)', ' (GPU)', ' (Plugin)']) {
    const helper = join(contents, 'Frameworks', `Orca Helper${type}.app`, 'Contents')
    file(join(helper, 'MacOS', `Orca Helper${type}`), `h ${code}`)
    file(join(helper, 'Info.plist'), plist(code))
  }
  file(join(contents, 'Frameworks', 'Squirrel.framework', 'y'), 'squirrel')
  file(join(contents, 'Resources', 'app.asar'), `asar ${version}`)
  file(join(contents, 'Resources', 'profile-template', 'orca-notification-status'), 'profile')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-profile-refresh-'))
  app = join(dir, 'Orca.app')
  defaultApp('1.0')
  calls = []
  signed = []
  failSign = false
  h.failSwap = false
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
      makeIcon: () => ({
        icns: Buffer.from('icns'),
        icon: { kind: 'badge' as const, text: 'W', style: 'ref-match' as const }
      })
    })
    const contents = join(entry.appPath, 'Contents')
    calls = []
    return { entry, contents }
  }

  const forced = () => calls.filter((call) => call.includes('--force'))

  it('does no work when the default app has the same version, with the check file', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    expect(refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })).toBe(false)
    calls = []
    expect(refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })).toBe(false)
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
    // A new Resources entry gets its link.
    expect(lstatSync(join(contents, 'Resources', 'new.pak')).isSymbolicLink()).toBe(true)
    // The new bundle is signed before it takes the app's place.
    expect(signed.at(-1)?.path).toMatch(/\/\.work\.refresh-[^/]+\/Work\.app$/)
    // The data folder is not touched. The previous bundle stays until the next start.
    expect(existsSync(join(entry.userDataPath, 'orca-app-profile.json'))).toBe(true)
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['Work.app', 'Work.app.pre-refresh'])
    // The key is recorded: the next start does no work, and removes the previous bundle.
    calls = []
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(false)
    expect(readdirSync(join(dir, 'apps'))).toEqual(['Work.app'])
  })

  it('does not sign again after a rename alone', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })
    const renamed = join(dir, 'apps', 'Job.app')
    renameSync(entry.appPath, renamed)
    calls = []
    expect(refreshAppProfileBundle(renamed, app, run, { checkFile: check })).toBe(false)
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

  it('gives each helper type its own name and entitlements, not those of the main app', () => {
    const { entry, contents } = make()
    defaultApp('2.0')
    refreshAppProfileBundle(entry.appPath, app, run)
    for (const type of ['', ' (Renderer)', ' (GPU)', ' (Plugin)']) {
      const helper = join(contents, 'Frameworks', `Work Helper${type}.app`)
      for (const name of ['CFBundleExecutable', 'CFBundleName', 'CFBundleDisplayName']) {
        expect(key(join(helper, 'Contents', 'Info.plist'), name)).toBe(`Work Helper${type}`)
      }
      const sign = signed.find((entry) => entry.path.endsWith(`/Work Helper${type}.app`))
      expect(sign?.entitlements).toBe(
        `<plist>Orca Helper${type}.app${type === ' (Renderer)' ? ' allow-jit' : ''}</plist>`
      )
    }
  })

  it('builds the new bundle fresh: no Finder data of the old bundle comes along', () => {
    const { entry } = make()
    execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', FINDER_INFO, entry.appPath])
    file(join(entry.appPath, 'Icon\r'), '')
    defaultApp('2.0')
    expect(refreshAppProfileBundle(entry.appPath, app, run)).toBe(true)
    expect(signed.at(-1)?.finderInfo).toBe(false)
    expect(finderInfoOf(entry.appPath)).toBe('')
    expect(existsSync(join(entry.appPath, 'Icon\r'))).toBe(false)
  })

  it('puts the kept icon into the new bundle before the seal, and the Finder icon after it', () => {
    const { entry, contents } = make()
    writeFileSync(join(entry.userDataPath, 'profile-icon.icns'), 'kept icns')
    defaultApp('2.0')
    expect(
      refreshAppProfileBundle(entry.appPath, app, run, { userDataPath: entry.userDataPath })
    ).toBe(true)
    expect(lstatSync(join(contents, 'Resources', 'icon.icns')).isSymbolicLink()).toBe(false)
    expect(read(join(contents, 'Resources', 'icon.icns'))).toBe('kept icns')
    const bundleSign = calls.findLastIndex(
      (call) => call[0].endsWith('codesign') && call[1] === '--force'
    )
    const finderIcon = calls.findIndex((call) => call[0] === '/usr/bin/env')
    expect(finderIcon).toBeGreaterThan(bundleSign)
    expect(calls[finderIcon]).toContain('/usr/bin/osascript')
  })

  it('refreshes when the check file names an older version (p1)', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    writeFileSync(check, '1.0')
    defaultApp('2.0')
    expect(refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })).toBe(true)
  })

  it('checks again when a needed copy is missing, whatever the check file says', () => {
    const { entry, contents } = make()
    const check = join(dir, 'check.txt')
    refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })
    rmSync(join(contents, 'Frameworks', 'Work Helper (Renderer).app'), { recursive: true })
    expect(refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })).toBe(true)
    expect(existsSync(join(contents, 'Frameworks', 'Work Helper (Renderer).app'))).toBe(true)
  })

  it('keeps the check file when a refresh fails (p2)', () => {
    const { entry } = make()
    const check = join(dir, 'check.txt')
    refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })
    const before = read(check)
    defaultApp('2.0')
    failSign = true
    expect(() => refreshAppProfileBundle(entry.appPath, app, run, { checkFile: check })).toThrow()
    expect(read(check)).toBe(before)
  })

  it('puts the app back when the new bundle cannot take its place (o2)', () => {
    const { entry, contents } = make()
    defaultApp('2.0')
    h.failSwap = true
    expect(() => refreshAppProfileBundle(entry.appPath, app, run)).toThrow('rename failed')
    expect(read(join(contents, 'MacOS', 'Orca'))).toBe('main 1.0')
    expect(readdirSync(join(dir, 'apps'))).toEqual(['Work.app'])
  })

  it('removes a previous bundle after the start, or puts it back when no live bundle has the id', () => {
    const { entry } = make()
    const apps = join(dir, 'apps')
    const previous = preRefreshPathOf(entry.appPath)
    execFileSync('/bin/cp', ['-cR', entry.appPath, previous])
    settlePreRefresh(apps, 'work', false)
    expect(existsSync(previous)).toBe(true)
    settlePreRefresh(apps, 'work')
    expect(existsSync(previous)).toBe(false)
    renameSync(entry.appPath, previous)
    settlePreRefresh(apps, 'work', false)
    expect(existsSync(join(entry.appPath, 'Contents', 'Info.plist'))).toBe(true)
    expect(existsSync(previous)).toBe(false)
  })

  it('does not bring back an old bundle after a Finder rename of the app', () => {
    const { entry } = make()
    const apps = join(dir, 'apps')
    execFileSync('/bin/cp', ['-cR', entry.appPath, preRefreshPathOf(entry.appPath)])
    renameSync(entry.appPath, join(apps, 'Job.app'))
    settlePreRefresh(apps, 'work', false)
    expect(readdirSync(apps).sort()).toEqual(['Job.app', 'Work.app.pre-refresh'])
    settlePreRefresh(apps, 'work')
    expect(readdirSync(apps)).toEqual(['Job.app'])
  })

  it('brings back only the newest of two previous bundles, and a remove deletes the rest', () => {
    const { entry } = make()
    const apps = join(dir, 'apps')
    const older = join(apps, 'Old.app.pre-refresh')
    execFileSync('/bin/cp', ['-cR', entry.appPath, older])
    utimesSync(older, new Date(1000), new Date(1000))
    renameSync(entry.appPath, preRefreshPathOf(entry.appPath))
    settlePreRefresh(apps, 'work', false)
    expect(readdirSync(apps).sort()).toEqual(['Old.app.pre-refresh', 'Work.app'])
    removePreRefreshLeftovers(apps, 'work')
    expect(readdirSync(apps)).toEqual(['Work.app'])
    // Another profile's previous bundle is not this profile's.
    expect(settlePreRefresh(apps, 'home')).toBeUndefined()
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

describe.skipIf(process.platform !== 'darwin')(
  'refreshAppProfileBundle with the real codesign',
  () => {
    // Real tools in the temp folder: ditto, cp, plutil, xattr and an ad hoc codesign. Only the
    // entitlements dump of the unsigned fixture and lsregister are stubbed.
    const realRun: RunTool = (program, args) => {
      if (program.endsWith('lsregister')) {
        return ''
      }
      if (program.endsWith('codesign') && args[0] === '-d') {
        return '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>'
      }
      if (program === '/usr/bin/env') {
        // What NSWorkspace setIcon writes: the Icon file with a fork, and Finder information.
        const bundle = (args.find((arg) => arg.startsWith('ORCA_APP_BUNDLE_PATH=')) ?? '').slice(21)
        finderIcon(bundle)
        return ''
      }
      return execFileSync(program, args, { encoding: 'utf8' })
    }
    const finderIcon = (bundle: string): void => {
      const icon = join(bundle, 'Icon\r')
      writeFileSync(icon, '')
      execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.ResourceFork', '00010203', icon])
      execFileSync('/usr/bin/xattr', [
        '-wx',
        'com.apple.FinderInfo',
        `${'0'.repeat(16)}4000${'0'.repeat(44)}`,
        icon
      ])
      execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', FINDER_INFO, bundle])
    }
    const machO = (path: string): void => {
      mkdirSync(join(path, '..'), { recursive: true })
      execFileSync('/bin/cp', ['/usr/bin/true', path])
    }
    /** A default app whose code is real Mach-O, with a signed Electron framework. */
    const realDefaultApp = (): void => {
      rmSync(app, { recursive: true, force: true })
      const contents = join(app, 'Contents')
      file(join(contents, 'Info.plist'), plist('1.0'))
      machO(join(contents, 'MacOS', 'Orca'))
      machO(join(contents, 'MacOS', 'orca-notification-status'))
      machO(join(contents, 'Resources', 'profile-template', 'orca-notification-status'))
      file(join(contents, 'Resources', 'app.asar'), 'asar')
      const helper = join(contents, 'Frameworks', 'Orca Helper (Renderer).app', 'Contents')
      machO(join(helper, 'MacOS', 'Orca Helper (Renderer)'))
      file(
        join(helper, 'Info.plist'),
        plist('1.0').replace('<string>Orca</string>', '<string>Orca Helper (Renderer)</string>')
      )
      const framework = join(contents, 'Frameworks', 'Electron Framework.framework')
      machO(join(framework, 'Versions', 'A', 'Electron Framework'))
      file(
        join(framework, 'Versions', 'A', 'Resources', 'Info.plist'),
        plist('43').replace('<string>Orca</string>', '<string>Electron Framework</string>')
      )
      execFileSync('/bin/ln', ['-s', 'A', join(framework, 'Versions', 'Current')])
      execFileSync('/bin/ln', [
        '-s',
        'Versions/Current/Electron Framework',
        join(framework, 'Electron Framework')
      ])
      execFileSync('/bin/ln', ['-s', 'Versions/Current/Resources', join(framework, 'Resources')])
      execFileSync('/usr/bin/codesign', ['--force', '-s', '-', framework])
    }

    it('refreshes a bundle with Finder information and an Icon file with a resource fork', () => {
      realDefaultApp()
      const entry = createAppProfile({
        name: 'Work',
        defaultAppPath: app,
        env: env(),
        run: realRun,
        pinRoot: true,
        makeIcon: () => ({
          icns: Buffer.from('icns'),
          icon: { kind: 'badge' as const, text: 'W', style: 'ref-match' as const }
        })
      })
      // What a Finder custom icon leaves: Finder information on the bundle, and Icon\r with a fork.
      const icon = join(entry.appPath, 'Icon\r')
      writeFileSync(icon, '')
      execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.ResourceFork', '00010203', icon])
      // The Icon file is invisible: Finder information with the invisible flag.
      execFileSync('/usr/bin/xattr', [
        '-wx',
        'com.apple.FinderInfo',
        `${'0'.repeat(16)}4000${'0'.repeat(44)}`,
        icon
      ])
      execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', FINDER_INFO, entry.appPath])
      // An update that changes the runtime parts: a new Resources entry.
      file(join(app, 'Contents', 'Resources', 'new.pak'), 'new')
      file(join(app, 'Contents', 'Info.plist'), plist('2.0'))
      writeFileSync(join(entry.userDataPath, 'profile-icon.icns'), 'kept icns')
      expect(
        refreshAppProfileBundle(entry.appPath, app, realRun, { userDataPath: entry.userDataPath })
      ).toBe(true)
      expect(() => execFileSync('/usr/bin/codesign', ['--verify', entry.appPath])).not.toThrow()
      expect(key(join(entry.appPath, 'Contents', 'Info.plist'), 'CFBundleVersion')).toBe('2.0')
      // The custom icon is kept: the icon file in the seal, the Finder icon after it.
      expect(read(join(entry.appPath, 'Contents', 'Resources', 'icon.icns'))).toBe('kept icns')
      expect(finderInfoOf(entry.appPath)).toBe(FINDER_INFO)
    })
  }
)
