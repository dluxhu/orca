// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  appProfilesRoot,
  readAppProfileRegistry,
  type AppProfileEntry,
  type AppProfileIcon,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import {
  keepProfileIcon,
  makeAppProfileIcon,
  withNameBadge,
  type AppProfileIconSource
} from './app-profile-icon'
import { prepare, rootOf, updateEntry, type EditAppProfileOptions } from './app-profile-edit'
import { withRegistryLockAsync, writeRegistry } from './app-profile-registry'
import { setFinderIcon } from './app-profile-bundle-icon'

export type SetAppProfileIconOptions = Omit<EditAppProfileOptions, 'id'> & {
  /** Tests only: the icon renderer. */
  makeIcon?: typeof makeAppProfileIcon
  /**
   * Only for a profile without an icon in profiles.json (made before profile icons): the profile
   * app asks for its icon at start, so it may run. A profile with an icon does not change.
   */
  ifMissing?: boolean
  /** The profile app changes its own icon (Settings): it shows the new one itself. */
  whileRunning?: boolean
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
    const appMayRun = options.ifMissing || options.whileRunning
    const context = await prepare(edit, 'edit', appMayRun)
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
    const refreshed = await prepare(edit, 'edit', appMayRun)
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

/**
 * The default app's own icon (Settings > Appearance): the kept icon in its userData, recorded as
 * profiles.json `defaultIcon`. Without a badge the appIcon setting alone is the icon, so `none`
 * removes both. The CLI sets no Finder icon: the app sets it with its Dock tile (applyAppIcon).
 */
export async function setDefaultAppIcon(
  icon: AppProfileIconSource,
  options: Pick<SetAppProfileIconOptions, 'env' | 'home' | 'makeIcon'> & {
    defaultAppPath: string
    defaultUserDataPath?: string
  }
): Promise<{ id: 'default'; icon?: AppProfileIcon }> {
  const root = appProfilesRoot(options.env ?? process.env, options.home ?? homedir())
  // The first profile makes the folder; the default app's icon can come first.
  mkdirSync(root, { recursive: true })
  return withRegistryLockAsync(root, async () => {
    const registry: AppProfileRegistry = readAppProfileRegistry(root) ?? {
      version: 1,
      defaultAppPath: options.defaultAppPath,
      urlHandler: { mode: 'ask' },
      profiles: []
    }
    const userDataPath = options.defaultUserDataPath ?? getPlatformUserDataPath()
    const { defaultIcon: _old, ...rest } = registry
    if (icon.kind === 'none') {
      keepProfileIcon(userDataPath, {})
      writeRegistry(root, rest)
      return { id: 'default' }
    }
    const used = registry.profiles.map((profile) => profile.icon)
    const made = (options.makeIcon ?? makeAppProfileIcon)(
      registry.defaultAppPath,
      withNameBadge(icon, 'Orca', used),
      used
    )
    keepProfileIcon(userDataPath, made)
    writeRegistry(root, { ...rest, defaultIcon: made.icon })
    return { id: 'default', icon: made.icon }
  })
}
