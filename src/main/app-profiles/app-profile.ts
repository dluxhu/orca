// Which app profile this process runs. See docs/fork/profiles-design.md, section 1.
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { FORK_IDENTITY } from '../../shared/fork-identity'
import {
  APP_PROFILE_PLIST_ID_KEY,
  APP_PROFILE_PLIST_ROOT_KEY,
  appProfilesRoot,
  readAppProfileMarker,
  readPlistString
} from '../../shared/app-profiles/app-profile-paths'

export type AppProfile = {
  id: string
  /** The name that the Dock and the window title show. */
  name: string
  /** The bundle id that macOS uses for this process. */
  bundleId: string
  userDataPath: string
}

export type AppProfileInput = {
  /** The XML Info.plist of the running bundle, or null. */
  plist: string | null
  /** The running bundle. A rename in Finder changes only its file name. */
  bundlePath?: string
  userDataDirArg: string | null
  defaultRoot: string
  readMarker: (userDataPath: string) => string | null
}

/** Order: the bundle's own profile id, then the marker in --user-data-dir. */
export function resolveAppProfile(input: AppProfileInput): AppProfile | null {
  const plistId = input.plist ? readPlistString(input.plist, APP_PROFILE_PLIST_ID_KEY) : null
  if (input.plist && plistId) {
    const root = readPlistString(input.plist, APP_PROFILE_PLIST_ROOT_KEY) ?? input.defaultRoot
    const userDataPath = input.userDataDirArg ?? join(root, plistId)
    const markerId = input.readMarker(userDataPath)
    // A given folder must carry this profile's marker: a profile app must never take, and mark,
    // the default folder or another profile's folder.
    if (markerId ? markerId !== plistId : input.userDataDirArg !== null) {
      throw new Error(
        `This app is the profile "${plistId}", but ${userDataPath} is ${markerId ? `the profile "${markerId}"` : 'not this profile'}.`
      )
    }
    return {
      id: plistId,
      // The file name: a rename in Finder does not change Info.plist (its signature seals it).
      name: input.bundlePath
        ? basename(input.bundlePath, '.app')
        : (readPlistString(input.plist, 'CFBundleDisplayName') ?? plistId),
      bundleId: readPlistString(input.plist, 'CFBundleIdentifier') ?? FORK_IDENTITY.appId,
      userDataPath
    }
  }
  const markerId = input.userDataDirArg ? input.readMarker(input.userDataDirArg) : null
  if (input.userDataDirArg && markerId) {
    // The default app's executable serves a profile: the process keeps the default identity.
    return {
      id: markerId,
      name: FORK_IDENTITY.productName,
      bundleId: FORK_IDENTITY.appId,
      userDataPath: input.userDataDirArg
    }
  }
  return null
}

function readOwnInfoPlist(): string | null {
  try {
    return readFileSync(join(dirname(process.execPath), '..', 'Info.plist'), 'utf8')
  } catch {
    return null
  }
}

let resolved: AppProfile | null | undefined

// No electron import: orcad bundles this module too. Electron takes switches only as --name=value.
function userDataDirArg(): string | null {
  const arg = process.argv.find((value) => value.startsWith('--user-data-dir='))
  return arg ? arg.slice('--user-data-dir='.length) || null : null
}

/** The profile of this process, or null for the default app. Only packaged macOS Electron has profiles. */
export function getAppProfile(): AppProfile | null {
  if (resolved === undefined) {
    const packagedElectron = Boolean(process.versions.electron) && !process.defaultApp
    resolved =
      process.platform === 'darwin' && packagedElectron
        ? resolveAppProfile({
            plist: readOwnInfoPlist(),
            bundlePath: resolve(dirname(process.execPath), '..', '..'),
            userDataDirArg: userDataDirArg(),
            defaultRoot: appProfilesRoot(),
            readMarker: readAppProfileMarker
          })
        : null
  }
  return resolved
}

/** The name and bundle id of the running app. Use it in place of the build-time FORK_IDENTITY. */
export function runtimeAppIdentity(): { productName: string; appId: string } {
  const profile = getAppProfile()
  return profile
    ? { productName: profile.name, appId: profile.bundleId }
    : { productName: FORK_IDENTITY.productName, appId: FORK_IDENTITY.appId }
}

const markedUserData = new Map<string, boolean>()

/**
 * True in a profile app, and in any process (orcad too) that serves a profile's userData.
 * Such a process installs no managed hooks (the hook commands use the `.orca` folder in HOME)
 * and changes no config of the agents that stay on the real home.
 */
export function isAppProfileRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const userDataPath = env.ORCA_USER_DATA_PATH
  if (getAppProfile() !== null) {
    return true
  }
  if (!userDataPath) {
    return false
  }
  // The marker exists before any check runs (create, or the profile's start), so one read is enough.
  let marked = markedUserData.get(userDataPath)
  if (marked === undefined) {
    marked = readAppProfileMarker(userDataPath) !== null
    markedUserData.set(userDataPath, marked)
  }
  return marked
}
