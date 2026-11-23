// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APP_PROFILE_ICON_FILE,
  type AppProfileEntry
} from '../../shared/app-profiles/app-profile-paths'
import { appIconFileName, makeAppProfileIcon, type AppProfileIconSource } from './app-profile-icon'
import { LSREGISTER } from './app-profile-create'
import { prepare, rootOf, updateEntry, type EditAppProfileOptions } from './app-profile-edit'
import { withRegistryLockAsync } from './app-profile-registry'

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
    const contents = join(entry.appPath, 'Contents')
    const plist = readFileSync(join(contents, 'Info.plist'), 'utf8')
    const iconPath = join(contents, 'Resources', appIconFileName(plist))
    // A profile made before icons has a link to the default app's icon.
    const old: { link: string } | { bytes: Buffer } = lstatSync(iconPath).isSymbolicLink()
      ? { link: readlinkSync(iconPath) }
      : { bytes: readFileSync(iconPath) }
    const temporary = mkdtempSync(join(tmpdir(), 'orca-profile-icon-'))
    try {
      // Sign as create does: ad hoc, the profile's bundle id, the default app's entitlements.
      const entitlements = join(temporary, 'entitlements.plist')
      writeFileSync(
        entitlements,
        run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', registry.defaultAppPath])
      )
      rmSync(iconPath, { force: true })
      writeFileSync(iconPath, made.icns)
      try {
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
      } catch (error) {
        // The old icon matches the old seal again.
        rmSync(iconPath, { force: true })
        if ('link' in old) {
          symlinkSync(old.link, iconPath)
        } else {
          writeFileSync(iconPath, old.bytes)
        }
        throw error
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
    // The write must not follow a link in the data folder.
    rmSync(join(entry.userDataPath, APP_PROFILE_ICON_FILE), { force: true })
    writeFileSync(join(entry.userDataPath, APP_PROFILE_ICON_FILE), made.icns)
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
