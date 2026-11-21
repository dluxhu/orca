import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isAppProfileRuntime, resolveAppProfile } from './app-profile'

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

  it('stops when the bundle and the marker name different profiles', () => {
    expect(() =>
      resolveAppProfile({
        plist: profilePlist,
        userDataDirArg: '/x',
        defaultRoot: '/root',
        readMarker: () => 'home'
      })
    ).toThrow('belongs to the profile "home"')
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
    const dir = mkdtempSync(join(tmpdir(), 'orca-profile-runtime-'))
    try {
      expect(isAppProfileRuntime({ ORCA_USER_DATA_PATH: dir })).toBe(false)
      writeFileSync(join(dir, 'orca-app-profile.json'), '{"id":"work"}')
      expect(isAppProfileRuntime({ ORCA_USER_DATA_PATH: dir })).toBe(true)
      expect(isAppProfileRuntime({})).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
