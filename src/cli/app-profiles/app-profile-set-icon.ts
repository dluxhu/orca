// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  appProfilesRoot,
  readAppProfileRegistry,
  type AppProfileEntry
} from '../../shared/app-profiles/app-profile-paths'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import { keepProfileIcon, makeAppProfileIcon, type AppProfileIconSource } from './app-profile-icon'
import { MAC_DOCK_ICON_SCRIPT } from '../../shared/app-lifecycle/identity/mac-custom-icon-script'
import { RuntimeClientError } from '../runtime/connection/types'
import { runTool, type RunTool } from './app-profile-create'
import { isProcessAlive, withRegistryLock, writeRegistry } from './app-profile-registry'

export type SetAppProfileIconOptions = {
  env?: NodeJS.ProcessEnv
  home?: string
  run?: RunTool
  /** Tests only: the icon renderer. */
  makeIcon?: typeof makeAppProfileIcon
  isAlive?: (pid: number) => boolean
}

// shortcut: a live runtime pid also refuses when only the serve service runs; use the state of `orca profiles list` when it merges.
function runs(userDataPath: string, isAlive: (pid: number) => boolean): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(getRuntimeMetadataPath(userDataPath), 'utf8')) as {
      pid?: unknown
    }
    return typeof pid === 'number' && pid > 0 && isAlive(pid)
  } catch {
    return false
  }
}

/**
 * Gives the profile app a new icon and records it in profiles.json. The icon is a Finder custom icon,
 * as Get Info sets it: the signed bundle contents stay as create made them. A new signature would
 * make the Keychain ask the user again for the app's stored keys.
 */
export function setAppProfileIcon(
  id: string,
  icon: AppProfileIconSource,
  options: SetAppProfileIconOptions = {}
): AppProfileEntry {
  const root = resolve(appProfilesRoot(options.env ?? process.env, options.home ?? homedir()))
  const run = options.run ?? runTool
  return withRegistryLock(root, () => {
    const registry = readAppProfileRegistry(root)
    const entry = registry?.profiles.find((profile) => profile.id === id)
    if (!registry || !entry) {
      throw new RuntimeClientError('invalid_argument', `No profile "${id}".`)
    }
    const refuseWhileRunning = (): void => {
      if (runs(entry.userDataPath, options.isAlive ?? isProcessAlive)) {
        throw new RuntimeClientError(
          'profile_running',
          `"${entry.name}" runs. Quit it, and stop its server, before you change its icon.`
        )
      }
    }
    refuseWhileRunning()
    const made = (options.makeIcon ?? makeAppProfileIcon)(
      registry.defaultAppPath,
      icon,
      registry.profiles.filter((profile) => profile.id !== id).map((profile) => profile.icon)
    )
    // The icon takes seconds to make. The app can start in that time.
    refuseWhileRunning()
    const temporary = mkdtempSync(join(tmpdir(), 'orca-profile-icon-'))
    try {
      const iconPath = join(temporary, 'icon.icns')
      writeFileSync(iconPath, made.icns)
      run('/usr/bin/env', [
        `ORCA_APP_BUNDLE_PATH=${entry.appPath}`,
        `ORCA_APP_ICON_PATH=${iconPath}`,
        '/usr/bin/osascript',
        ...MAC_DOCK_ICON_SCRIPT.flatMap((line) => ['-e', line])
      ])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
    keepProfileIcon(entry.userDataPath, made)
    const changed = { ...entry, icon: made.icon }
    writeRegistry(root, {
      ...registry,
      profiles: registry.profiles.map((profile) => (profile.id === id ? changed : profile))
    })
    return changed
  })
}
