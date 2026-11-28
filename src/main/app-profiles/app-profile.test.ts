import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isAppProfileRuntime, resolveAppProfile } from './app-profile'
import {
  ensureAppProfileMarker,
  readAppProfileMarker
} from '../../shared/app-profiles/app-profile-paths'
import { applyAppProfileHomes } from '../../shared/app-profiles/app-profile-homes'

const plist = (entries: Record<string, string>): string =>
  `<plist><dict>${Object.entries(entries)
    .map(([key, value]) => `<key>${key}</key>\n\t<string>${value}</string>`)
    .join('')}</dict></plist>`

const profilePlist = plist({
  CFBundleIdentifier: 'com.stablyai.orca.dlux.profile.work',
  CFBundleDisplayName: 'Orca - Work',
  OrcaAppProfileId: 'work'
})

describe('resolveAppProfile', () => {
  it('takes the profile from the bundle and its folder under the profiles root', () => {
    expect(
      resolveAppProfile({
        plist: profilePlist,
        userDataDirArg: null,
        defaultRoot: '/root',
        readMarker: () => null
      })
    ).toEqual({
      id: 'work',
      name: 'Orca - Work',
      bundleId: 'com.stablyai.orca.dlux.profile.work',
      userDataPath: '/root/work'
    })
  })

  it('uses the test root from the bundle and --user-data-dir before the root', () => {
    const withRoot = profilePlist.replace(
      '</dict>',
      '<key>OrcaAppProfilesRoot</key><string>/test root</string></dict>'
    )
    const input = { plist: withRoot, defaultRoot: '/root', readMarker: () => 'work' }
    expect(resolveAppProfile({ ...input, userDataDirArg: null })?.userDataPath).toBe(
      '/test root/work'
    )
    expect(resolveAppProfile({ ...input, userDataDirArg: '/given' })?.userDataPath).toBe('/given')
  })

  it('keeps the id and folder after a Finder rename, and shows the file name', () => {
    expect(
      resolveAppProfile({
        plist: profilePlist,
        bundlePath: '/Users/x/Applications/Orca Profiles/Orca - Finder.app',
        userDataDirArg: null,
        defaultRoot: '/root',
        readMarker: () => null
      })
    ).toMatchObject({ id: 'work', name: 'Orca - Finder', userDataPath: '/root/work' })
  })

  it('refuses an id or a data folder that leaves the profiles root', () => {
    const base = mkdtempSync(join(tmpdir(), 'orca-profile-id-'))
    try {
      const root = join(base, 'profiles')
      mkdirSync(root)
      mkdirSync(join(base, 'orca'))
      const resolveId = (id: string) =>
        resolveAppProfile({
          plist: plist({ CFBundleIdentifier: 'b', OrcaAppProfileId: id }),
          userDataDirArg: null,
          defaultRoot: root,
          readMarker: readAppProfileMarker
        })
      for (const id of ['../orca', '/tmp/x', 'default']) {
        expect(() => resolveId(id)).toThrow('does not accept')
      }
      // A link at <root>/<id> to another folder.
      symlinkSync(join(base, 'orca'), join(root, 'work'))
      expect(() => resolveId('work')).toThrow('is outside')
      expect(existsSync(join(base, 'orca', 'orca-app-profile.json'))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("refuses a plist root that points at the default app's data, or a folder without its marker", () => {
    const base = mkdtempSync(join(tmpdir(), 'orca-profile-root-'))
    try {
      const appSupport = join(base, 'Library', 'Application Support')
      const defaultData = join(appSupport, 'orca')
      mkdirSync(defaultData, { recursive: true })
      writeFileSync(join(defaultData, 'orca-settings.json'), '{}')
      const resolveWith = (id: string, root: string, defaultDataPath = defaultData) =>
        resolveAppProfile({
          plist: plist({
            CFBundleIdentifier: 'b',
            OrcaAppProfileId: id,
            OrcaAppProfilesRoot: root
          }),
          userDataDirArg: null,
          defaultRoot: join(base, 'profiles'),
          readMarker: readAppProfileMarker,
          defaultDataPath
        })
      expect(() => resolveWith('orca', appSupport)).toThrow("default app's data")
      // Without the default-data rule, the marker rule still refuses the folder.
      expect(() => resolveWith('orca', appSupport, join(base, 'elsewhere'))).toThrow(
        'is not this profile'
      )
      expect(existsSync(join(defaultData, 'orca-app-profile.json'))).toBe(false)
      // A missing folder is fine: the profile app makes it with its marker.
      expect(resolveWith('work', join(base, 'profiles'))?.userDataPath).toBe(
        join(base, 'profiles', 'work')
      )
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses a link into a sibling folder whose name starts with the root name', () => {
    const base = mkdtempSync(join(tmpdir(), 'orca-profile-sibling-'))
    try {
      const root = join(base, 'profiles')
      const sibling = join(base, 'profiles-x', 'work')
      mkdirSync(root)
      mkdirSync(sibling, { recursive: true })
      writeFileSync(join(sibling, 'orca-app-profile.json'), '{"id":"work"}')
      symlinkSync(sibling, join(root, 'work'))
      expect(() =>
        resolveAppProfile({
          plist: plist({ CFBundleIdentifier: 'b', OrcaAppProfileId: 'work' }),
          userDataDirArg: null,
          defaultRoot: root,
          readMarker: readAppProfileMarker
        })
      ).toThrow('is outside')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('stops when the bundle and the marker name different profiles', () => {
    expect(() =>
      resolveAppProfile({
        plist: profilePlist,
        userDataDirArg: '/x',
        defaultRoot: '/root',
        readMarker: () => 'home'
      })
    ).toThrow('is the profile "home"')
  })

  it('stops when a given folder has no marker: it never takes the default folder', () => {
    // `orca --profile default serve` from a profile terminal must not mark the default folder.
    expect(() =>
      resolveAppProfile({
        plist: profilePlist,
        userDataDirArg: '/Library/Application Support/orca',
        defaultRoot: '/root',
        readMarker: () => null
      })
    ).toThrow('is not this profile')
  })

  it('finds a profile served by the default executable through the marker only', () => {
    const defaultPlist = plist({ CFBundleIdentifier: 'com.stablyai.orca.dlux' })
    const readMarker = (path: string): string | null => (path === '/root/work' ? 'work' : null)
    expect(
      resolveAppProfile({
        plist: defaultPlist,
        userDataDirArg: '/root/work',
        defaultRoot: '/root',
        readMarker
      })
    ).toMatchObject({ id: 'work', bundleId: 'com.stablyai.orca.dlux', userDataPath: '/root/work' })
    expect(
      resolveAppProfile({
        plist: defaultPlist,
        userDataDirArg: '/other',
        defaultRoot: '/root',
        readMarker
      })
    ).toBeNull()
    // The default userData folder is never read: the app does not know it yet.
    expect(
      resolveAppProfile({
        plist: defaultPlist,
        userDataDirArg: null,
        defaultRoot: '/root',
        readMarker
      })
    ).toBeNull()
  })
})

describe('isAppProfileRuntime', () => {
  it("is true for a process that serves a profile's userData, orcad too", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(isAppProfileRuntime(env)).toBe(false)
    applyAppProfileHomes('/profiles/work', env)
    expect(isAppProfileRuntime(env)).toBe(true)
    applyAppProfileHomes(null, env)
    expect(isAppProfileRuntime(env)).toBe(false)
    expect(isAppProfileRuntime({ ORCA_HOME_DIR: '/user/orca' })).toBe(false)
  })
})

describe('ensureAppProfileMarker', () => {
  it('writes a missing marker, so orcad finds the profile, and keeps an existing one', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-profile-marker-'))
    try {
      const userData = join(root, 'work')
      ensureAppProfileMarker(userData, 'work')
      expect(JSON.parse(readFileSync(join(userData, 'orca-app-profile.json'), 'utf8'))).toEqual({
        id: 'work'
      })
      writeFileSync(join(userData, 'orca-app-profile.json'), '{"id":"work","kept":true}')
      ensureAppProfileMarker(userData, 'work')
      expect(readFileSync(join(userData, 'orca-app-profile.json'), 'utf8')).toContain('kept')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
