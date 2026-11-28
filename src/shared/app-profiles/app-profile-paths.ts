// App profiles: one Orca app per profile on macOS. See docs/fork/profiles-design.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { IconStyle } from '../icon-badger/badger'

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

/**
 * The base icon of a profile icon: a built-in app icon (appIcon ids; none is `classic`), or
 * `custom`, an uploaded image kept as APP_PROFILE_BASE_FILE.
 */
export type AppProfileIconBase = 'classic' | 'watercolor' | 'blue' | 'custom'

/**
 * The source of the profile icon: a base icon with a badge character, an uploaded badge image or
 * no badge. `file` is an uploaded icon with no badge; the kept icon is that image.
 */
export type AppProfileIcon =
  // color: #rrggbb; none is APP_PROFILE_BADGE_COLOR.
  | { kind: 'badge'; text: string; style: IconStyle; color?: string; base?: AppProfileIconBase }
  | { kind: 'image'; style: IconStyle; base?: AppProfileIconBase }
  | { kind: 'none'; base: Exclude<AppProfileIconBase, 'custom'> }
  | { kind: 'file' }

export {
  APP_PROFILE_BADGE_COLOR,
  APP_PROFILE_BADGE_FILE,
  APP_PROFILE_ICON_FILE
} from './app-profile-icon-files'

export type AppProfileEntry = {
  id: string
  name: string
  bundleId: string
  appPath: string
  userDataPath: string
  port: number
  icon?: AppProfileIcon
  createdAt: number
}

export type AppProfileRegistry = {
  version: 1
  defaultAppPath: string
  /** The default app's saved port. Without it, the default app uses DEFAULT_WS_PORT. */
  defaultPort?: number
  /** The default app's own icon (Settings > Appearance). None: the appIcon setting alone. */
  defaultIcon?: AppProfileIcon
  urlHandler: { mode: 'ask' } | { mode: 'profile'; profileId: string }
  profiles: AppProfileEntry[]
}

/**
 * The name of the Profile Manager app. The build script
 * config/scripts/desktop-distribution/macos/macos-profile-manager-app.cjs has its own copy of this
 * name and of the role; its test checks that they agree.
 */
export const PROFILE_MANAGER_APP_NAME = 'Orca Profile Manager'

/** The Profile Manager app inside a default app. The release build makes it. */
export function profileManagerAppPath(defaultAppPath: string): string {
  return join(defaultAppPath, 'Contents', 'Applications', `${PROFILE_MANAGER_APP_NAME}.app`)
}

/**
 * True for the Profile Manager app: its Info.plist role, or its place in a default app. The place
 * alone is enough, so a copy of Orca in that place never takes the default app's data.
 */
export function isProfileManagerBundle(plist: string | null, bundlePath: string): boolean {
  return (
    (plist !== null && readPlistString(plist, APP_ROLE_PLIST_KEY) === PROFILE_MANAGER_ROLE) ||
    bundlePath === profileManagerAppPath(resolve(bundlePath, '..', '..', '..'))
  )
}

export function appProfilesRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env[APP_PROFILES_ROOT_ENV] || join(home, 'Library', 'Application Support', 'Orca Profiles')
}

export function appProfilesAppsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env[APP_PROFILES_APPS_DIR_ENV] || join(home, 'Applications', 'Orca Profiles')
}

/** The profile id in the text of a marker, or null. */
export function parseAppProfileMarker(text: string): string | null {
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

/**
 * The copy of the serve LaunchAgent that `serve service uninstall --keep-running` keeps in
 * userData. launchd does not load it at login; the profile app starts the job from it after a quit.
 */
export function serveUnitCopyPath(userDataPath: string): string {
  return join(userDataPath, 'serve-service-unit.plist')
}

/** The profile id in a userData folder, or null when the folder is not a profile's. */
export function readAppProfileMarker(userDataPath: string): string | null {
  try {
    return parseAppProfileMarker(readFileSync(join(userDataPath, APP_PROFILE_MARKER), 'utf8'))
  } catch {
    return null
  }
}

/**
 * The saved port of the app of a userData folder: the profile's port, or the default app's
 * defaultPort. `orca serve` uses it when no --port is given. Null when none is saved.
 */
export function savedAppPort(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): number | null {
  const registry = readAppProfileRegistry(appProfilesRoot(env, home))
  const id = readAppProfileMarker(userDataPath)
  const port =
    id === null ? registry?.defaultPort : registry?.profiles.find((p) => p.id === id)?.port
  // profiles.json is a user file.
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : null
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

/** The profile id in an app's Info.plist, or null. */
export function appProfileIdOfApp(appPath: string): string | null {
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
 * The profile's app: the registry path, or the one app in the same folder whose Info.plist has
 * this profile id (a rename in Finder changes only the file name). Null when there is none, or
 * more than one (a copy in Finder): Orca does not guess.
 */
export function locateAppProfileApp(entry: Pick<AppProfileEntry, 'id' | 'appPath'>): string | null {
  if (appProfileIdOfApp(entry.appPath) === entry.id) {
    return entry.appPath
  }
  try {
    const folder = dirname(entry.appPath)
    const names = readdirSync(folder).filter(
      (candidate) =>
        candidate.endsWith('.app') && appProfileIdOfApp(join(folder, candidate)) === entry.id
    )
    return names.length === 1 ? join(folder, names[0]) : null
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
