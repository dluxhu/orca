// App profiles: one Orca app per profile on macOS. See docs/fork/profiles-design.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The marker in a profile's userData. serve and orcad find the profile through it. */
export const APP_PROFILE_MARKER = 'orca-app-profile.json'
export const APP_PROFILES_REGISTRY = 'profiles.json'
/** Settings that a new profile applies once at its first start ("Copy settings from:"). */
export const APP_PROFILE_SETTINGS_SEED = 'orca-settings-seed.json'
/** The Info.plist key that makes a bundle a profile app. */
export const APP_PROFILE_PLIST_ID_KEY = 'OrcaAppProfileId'
/** Info.plist key for a test root. `orca profiles create --pin-root` writes it. */
export const APP_PROFILE_PLIST_ROOT_KEY = 'OrcaAppProfilesRoot'
/** Overrides the folder that holds profiles.json and the profile userData folders. */
export const APP_PROFILES_ROOT_ENV = 'ORCA_PROFILES_ROOT'
/** The argument that makes an Orca app open its Profile Manager window. */
export const PROFILE_MANAGER_ARG = '--orca-profile-manager'
/** The Info.plist key and value that make a bundle the Profile Manager app. */
export const APP_ROLE_PLIST_KEY = 'OrcaAppRole'
export const PROFILE_MANAGER_ROLE = 'profile-manager'
/** The Profile Manager app's userData folder in the profiles root. */
export const PROFILE_MANAGER_USER_DATA = '.manager'
/** Overrides the folder that holds the profile apps. */
export const APP_PROFILES_APPS_DIR_ENV = 'ORCA_PROFILES_APPS_DIR'

export type AppProfileEntry = {
  id: string
  name: string
  bundleId: string
  appPath: string
  userDataPath: string
  port: number
  createdAt: number
}

export type AppProfileRegistry = {
  version: 1
  defaultAppPath: string
  urlHandler: { mode: 'ask' } | { mode: 'profile'; profileId: string }
  profiles: AppProfileEntry[]
}

/** The name of the Profile Manager app. config/scripts/desktop-distribution/macos/macos-profile-manager-app.cjs uses it too. */
export const PROFILE_MANAGER_APP_NAME = 'Orca Profile Manager'

/** The Profile Manager app inside a default app. The release build makes it. */
export function profileManagerAppPath(defaultAppPath: string): string {
  return join(defaultAppPath, 'Contents', 'Applications', `${PROFILE_MANAGER_APP_NAME}.app`)
}

export function appProfilesRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env[APP_PROFILES_ROOT_ENV] || join(home, 'Library', 'Application Support', 'Orca Profiles')
}

export function appProfilesAppsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env[APP_PROFILES_APPS_DIR_ENV] || join(home, 'Applications', 'Orca Profiles')
}

/** The profile id in a userData folder, or null when the folder is not a profile's. */
export function readAppProfileMarker(userDataPath: string): string | null {
  try {
    const id = (
      JSON.parse(readFileSync(join(userDataPath, APP_PROFILE_MARKER), 'utf8')) as {
        id?: unknown
      }
    ).id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

/** Writes the marker when it is missing. serve and orcad find the profile only through it. */
export function ensureAppProfileMarker(userDataPath: string, id: string): void {
  const marker = join(userDataPath, APP_PROFILE_MARKER)
  if (!existsSync(marker)) {
    mkdirSync(userDataPath, { recursive: true, mode: 0o700 })
    writeFileSync(marker, `${JSON.stringify({ id })}\n`)
  }
}

export function readAppProfileRegistry(root: string): AppProfileRegistry | null {
  try {
    return JSON.parse(readFileSync(join(root, APP_PROFILES_REGISTRY), 'utf8')) as AppProfileRegistry
  } catch {
    return null
  }
}

function appProfileIdOfApp(appPath: string): string | null {
  try {
    return readPlistString(
      readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8'),
      APP_PROFILE_PLIST_ID_KEY
    )
  } catch {
    return null
  }
}

/**
 * The profile's app: the registry path, or the app in the same folder whose Info.plist has this
 * profile id (a rename in Finder changes only the file name). Null when neither exists.
 */
export function locateAppProfileApp(entry: Pick<AppProfileEntry, 'id' | 'appPath'>): string | null {
  if (appProfileIdOfApp(entry.appPath) === entry.id) {
    return entry.appPath
  }
  try {
    const folder = dirname(entry.appPath)
    const name = readdirSync(folder).find(
      (candidate) =>
        candidate.endsWith('.app') && appProfileIdOfApp(join(folder, candidate)) === entry.id
    )
    return name ? join(folder, name) : null
  } catch {
    return null
  }
}

/** One `<string>` value of a top-level key in an XML Info.plist. */
export function readPlistString(xml: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)
  return match
    ? match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
    : null
}
