// Changes the icon of a profile app: docs/fork/profiles-design.md, section 8.
// The Profile Manager and the CLI call setAppProfileIcon. Icon state goes by the profile id.
import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  APP_PROFILE_ICON_FILE,
  appProfilesRoot,
  readAppProfileRegistry,
  type AppProfileEntry
} from '../../shared/app-profiles/app-profile-paths'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import {
  appIconFileName,
  makeAppProfileIcon,
  type AppProfileIconSource
} from '../../main/app-profiles/app-profile-icon'
import { RuntimeClientError } from '../runtime/connection/types'
import { LSREGISTER, runTool, type RunTool } from './app-profile-create'
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

/** Writes a new icon into the profile app, signs it again and records it in profiles.json. */
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
    if (runs(entry.userDataPath, options.isAlive ?? isProcessAlive)) {
      throw new RuntimeClientError(
        'profile_running',
        `"${entry.name}" runs. Quit it, and stop its server, before you change its icon.`
      )
    }
    const made = (options.makeIcon ?? makeAppProfileIcon)(
      registry.defaultAppPath,
      icon,
      registry.profiles.filter((profile) => profile.id !== id).map((profile) => profile.icon)
    )
    const contents = join(entry.appPath, 'Contents')
    const plist = readFileSync(join(contents, 'Info.plist'), 'utf8')
    const iconPath = join(contents, 'Resources', appIconFileName(plist))
    rmSync(iconPath, { force: true })
    writeFileSync(iconPath, made.icns)
    writeFileSync(join(entry.userDataPath, APP_PROFILE_ICON_FILE), made.icns)
    // The seal covers the icon. Ad hoc as at create: same identifier and entitlements, no --deep.
    run('/usr/bin/codesign', [
      '--force',
      '-s',
      '-',
      '--preserve-metadata=identifier,entitlements',
      entry.appPath
    ])
    // The Dock and Finder read the icon again after a touch and a new registration.
    const now = new Date()
    utimesSync(entry.appPath, now, now)
    run(LSREGISTER, ['-f', entry.appPath])
    const changed = { ...entry, icon: made.icon }
    writeRegistry(root, {
      ...registry,
      profiles: registry.profiles.map((profile) => (profile.id === id ? changed : profile))
    })
    return changed
  })
}
