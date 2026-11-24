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
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  appProfilesRoot,
  readAppProfileRegistry,
  type AppProfileEntry
} from '../../shared/app-profiles/app-profile-paths'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import {
  appIconFileName,
  keepProfileIcon,
  makeAppProfileIcon,
  type AppProfileIconSource
} from './app-profile-icon'
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
    keepProfileIcon(entry.userDataPath, made)
    const changed = { ...entry, icon: made.icon }
    writeRegistry(root, {
      ...registry,
      profiles: registry.profiles.map((profile) => (profile.id === id ? changed : profile))
    })
    // The Dock and Finder read the icon again after a touch and a new registration.
    const now = new Date()
    utimesSync(entry.appPath, now, now)
    run(LSREGISTER, ['-f', entry.appPath])
    return changed
  })
}
