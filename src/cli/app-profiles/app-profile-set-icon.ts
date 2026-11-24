// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppProfileEntry } from '../../shared/app-profiles/app-profile-paths'
import { keepProfileIcon, makeAppProfileIcon, type AppProfileIconSource } from './app-profile-icon'
import { LSREGISTER } from './app-profile-create'
import { prepare, rootOf, updateEntry, type EditAppProfileOptions } from './app-profile-edit'
import { withRegistryLockAsync } from './app-profile-registry'
import { swapBundleIcon } from './app-profile-bundle-icon'

export type SetAppProfileIconOptions = Omit<EditAppProfileOptions, 'id'> & {
  /** Tests only: the icon renderer. */
  makeIcon?: typeof makeAppProfileIcon
}

/** Writes a new icon into the profile app, signs it again and records it in profiles.json. */
export async function setAppProfileIcon(
  id: string,
  icon: AppProfileIconSource,
  options: SetAppProfileIconOptions = {}
): Promise<AppProfileEntry> {
  const edit = { ...options, id }
  return withRegistryLockAsync(rootOf(edit, 'edit'), async () => {
    const context = await prepare(edit, 'edit')
    const { registry, run } = context
    const made = (options.makeIcon ?? makeAppProfileIcon)(
      registry.defaultAppPath,
      icon,
      registry.profiles.filter((profile) => profile.id !== id).map((profile) => profile.icon)
    )
    // The icon takes seconds to make. The app can start, or move in Finder, in that time.
    const refreshed = await prepare(edit, 'edit')
    const { entry } = refreshed
    const temporary = mkdtempSync(join(tmpdir(), 'orca-profile-icon-'))
    try {
      // Sign as create does: ad hoc, the profile's bundle id, the default app's entitlements.
      const entitlements = join(temporary, 'entitlements.plist')
      writeFileSync(
        entitlements,
        run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', registry.defaultAppPath])
      )
      swapBundleIcon(entry.appPath, made.icns, () =>
        run('/usr/bin/codesign', [
          '--force',
          '-s',
          '-',
          '-i',
          entry.bundleId,
          '--entitlements',
          entitlements,
          entry.appPath
        ])
      )
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
    keepProfileIcon(entry.userDataPath, made)
    updateEntry(refreshed, (current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === id ? { ...profile, icon: made.icon } : profile
      )
    }))
    // The Dock and Finder read the icon again after a touch and a new registration.
    const now = new Date()
    utimesSync(entry.appPath, now, now)
    run(LSREGISTER, ['-f', entry.appPath])
    return { ...entry, icon: made.icon }
  })
}
