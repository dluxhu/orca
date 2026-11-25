// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import type { AppProfileEntry } from '../../shared/app-profiles/app-profile-paths'
import {
  keepProfileIcon,
  makeAppProfileIcon,
  withNameBadge,
  type AppProfileIconSource
} from './app-profile-icon'
import { prepare, rootOf, updateEntry, type EditAppProfileOptions } from './app-profile-edit'
import { withRegistryLockAsync } from './app-profile-registry'
import { setFinderIcon } from './app-profile-bundle-icon'

export type SetAppProfileIconOptions = Omit<EditAppProfileOptions, 'id'> & {
  /** Tests only: the icon renderer. */
  makeIcon?: typeof makeAppProfileIcon
  /**
   * Only for a profile without an icon in profiles.json (made before profile icons): the profile
   * app asks for its icon at start, so it may run. A profile with an icon does not change.
   */
  ifMissing?: boolean
}

/**
 * Gives the profile app a new icon and records it in profiles.json. The icon is a Finder custom icon,
 * as Get Info sets it: the signed bundle contents stay as create made them. A new signature would
 * make the Keychain ask the user again for the app's stored keys.
 */
export async function setAppProfileIcon(
  id: string,
  icon: AppProfileIconSource,
  options: SetAppProfileIconOptions = {}
): Promise<AppProfileEntry> {
  const edit = { ...options, id }
  return withRegistryLockAsync(rootOf(edit, 'edit'), async () => {
    const context = await prepare(edit, 'edit', options.ifMissing)
    const { registry, run } = context
    if (options.ifMissing && context.entry.icon) {
      return context.entry
    }
    const used = registry.profiles.filter((profile) => profile.id !== id).map((p) => p.icon)
    const made = (options.makeIcon ?? makeAppProfileIcon)(
      registry.defaultAppPath,
      withNameBadge(icon, context.entry.name, used),
      used
    )
    // The icon takes seconds to make. The app can start, or move in Finder, in that time.
    const refreshed = await prepare(edit, 'edit', options.ifMissing)
    const { entry } = refreshed
    setFinderIcon(entry.appPath, made.icns, run)
    keepProfileIcon(entry.userDataPath, made)
    updateEntry(refreshed, (current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === id ? { ...profile, icon: made.icon } : profile
      )
    }))
    return { ...entry, icon: made.icon }
  })
}
