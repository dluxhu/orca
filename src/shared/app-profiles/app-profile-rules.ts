// Names, ids and ports of app profiles: docs/fork/profiles-design.md, sections 4 and 9.
// The CLI applies these rules. The Profile Manager shows the same errors before it calls the CLI.
import type { IconStyle } from '../icon-badger/badger'
import type { CustomAppIconImportFailureCode } from '../app-lifecycle/identity/app-icon'
import type { AppProfileIcon } from './app-profile-paths'
import { APP_PROFILE_BADGE_SWATCHES } from './app-profile-icon-files'

/** The built-in port of the default app (DEFAULT_WS_PORT). profiles.json can save another. */
export const DEFAULT_APP_PORT = 6768
const PROFILE_PORT_BASE = 6800
const PORT_SPACING = 32
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/
const RESERVED_IDS = ['default', 'all', 'manager']

export type AppProfileState = 'running' | 'background' | 'stopped'

/** One row of `orca profiles list --json`. The default app is the row with id `default`. */
export type AppProfileRow = {
  id: string
  name: string
  appPath: string
  userDataPath: string
  /** The saved port (profiles.json). */
  port: number
  /** The port that the profile's live server listens on. Absent when no server runs. */
  livePort?: number
  state: AppProfileState
  /** The profile's own serve service is installed (`orca serve service install`). */
  startAtLogin: boolean
  /** The profile's own serve service job runs. */
  serviceRuns?: boolean
  /** The registry `icon` field; for the default app, `defaultIcon`. */
  icon?: AppProfileIcon
}

/** What makes a profile icon: a badge character, a badge image file or a full icon file. */
// base: a built-in id of AppProfileIconBase (none is `classic`), or the path of an uploaded image.
export type AppProfileIconSource =
  // No text: the name's badge (withNameBadge), else the first free character (nextBadgeText).
  | { kind: 'badge'; text?: string; style?: IconStyle; color?: string; base?: string }
  | { kind: 'image'; path: string; style?: IconStyle; base?: string }
  // No badge: a built-in base alone. An uploaded base alone is `file`.
  | { kind: 'none'; base: 'classic' | 'watercolor' | 'blue' }
  | { kind: 'file'; path: string }

/** A chosen file: its path, or why upstream's custom icon import refused an uploaded base. */
export type ChosenIconFile = string | { code: CustomAppIconImportFailureCode } | null

/** The built-in bases, in the order of the appIcon setting. */
export const APP_PROFILE_ICON_BASES = ['classic', 'watercolor', 'blue'] as const

export function isBuiltInIconBase(
  value: unknown
): value is (typeof APP_PROFILE_ICON_BASES)[number] {
  return (APP_PROFILE_ICON_BASES as readonly unknown[]).includes(value)
}

const BADGE_CHARACTERS = [...'23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ']

/** The first of 2 to 9, then A to Z, that no profile uses as its badge. */
export function nextBadgeText(icons: readonly (AppProfileIcon | undefined)[]): string {
  const used = new Set(icons.map((icon) => (icon?.kind === 'badge' ? icon.text : null)))
  return BADGE_CHARACTERS.find((text) => !used.has(text)) ?? '2'
}

/** The word "Orca" in any script; an apostrophe and a letter after it belong to the word. */
const ORCA_WORD = /(?<![\p{L}\p{N}])orca(?![\p{L}\p{N}]|['’]\p{L})/giu

/**
 * The default badge of a profile name: its first letter or digit in upper case when no other
 * profile uses it, else nextBadgeText. The word "Orca" does not count; "Orca's" is another word.
 * The colour is a swatch (not the dark one) from a hash of the name, so each name keeps its colour.
 */
export function defaultBadge(
  name: string,
  icons: readonly (AppProfileIcon | undefined)[]
): { text: string; color: string } {
  const letter = /[\p{L}\p{N}]/u
  const first = (name.replace(ORCA_WORD, ' ').match(letter) ?? name.match(letter))?.[0] ?? ''
  // 'ß' becomes 'SS': a badge has one character.
  const upper = first.toUpperCase().length === 1 ? first.toUpperCase() : first
  const used = icons.some((icon) => icon?.kind === 'badge' && icon.text === upper)
  const text = upper && !used ? upper : nextBadgeText(icons)
  const colors = APP_PROFILE_BADGE_SWATCHES.slice(1)
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  }
  return { text, color: colors[hash % colors.length] }
}

/** What the Profile Manager window gets from the main process. */
export type AppProfilesState = {
  rows: AppProfileRow[]
  /** The id of the app that shows the Profile Manager. Null in the Profile Manager app. */
  currentId: string | null
  /** Ids of data folders that "Keep data" left. A new profile with such an id uses the folder. */
  keptIds: string[]
  /** Each app's own Dock icon as a PNG data URL, by row id. The main process sets it for the window. */
  icons?: Record<string, string>
}

/**
 * The `--icon-*` flags of an icon source. The CLI reads them with appProfileIconSourceFromFlags.
 */
export function appProfileIconFlags(source: AppProfileIconSource | undefined): string[] {
  if (!source) {
    return []
  }
  if (source.kind === 'file') {
    return ['--icon-file', source.path]
  }
  // `classic` is the default app's own icon, as no flag is.
  const base = source.base && source.base !== 'classic' ? ['--icon-base', source.base] : []
  if (source.kind === 'none') {
    return ['--no-badge', ...base]
  }
  const style = source.style ? ['--icon-style', source.style] : []
  if (source.kind === 'image') {
    return ['--icon-image', source.path, ...style, ...base]
  }
  // No text and no style still means a badge: the CLI makes the default one.
  return [
    ...(source.text ? ['--icon-badge', source.text] : []),
    ...style,
    ...(source.color ? ['--icon-color', source.color] : []),
    ...base
  ]
}

/** This app's own profile, for Settings. */
export type OwnAppProfile = {
  id: string
  /** The app name; the default badge character is its first letter. */
  name: string
  /** Start at login. */
  enabled: boolean
  /** The saved port. */
  port: number
  /** The saved ports of the other profiles, without the default app. */
  otherPorts: number[]
  /** The default app's saved port. */
  defaultPort: number
  /** A server of the profile runs, so its port must not change now. */
  serverRuns: boolean
  userDataPath: string
  /** The saved icon; for the default app, profiles.json `defaultIcon`. */
  icon?: AppProfileIcon
  /** The image that Settings imported (appIcon `custom`), when there is one. */
  customIconPath?: string
}

/** One change that the Profile Manager asks for. The main process runs `orca profiles` for it. */
export type AppProfileChange =
  | {
      kind: 'create'
      name: string
      id: string
      port: number
      copySettings: boolean
      /** No icon: the next free badge character. */
      icon?: AppProfileIconSource
    }
  | { kind: 'set-icon'; id: string; icon: AppProfileIconSource }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'set-port'; id: string; port: number }
  | { kind: 'remove'; id: string; keepData: boolean }
  /** Writes or removes the login item of the profile's own serve service. Nothing starts or stops. */
  | { kind: 'start-at-login'; id: string; enabled: boolean }
  /** Starts or stops the profile's own serve service now. Start at login stays as it is. */
  | { kind: 'service'; id: string; run: boolean }

/** The `--json` reply of `orca profiles`. */
export type AppProfileReply =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string } }

/**
 * The automatic id: the name without the word "Orca", in lower case, with `-` between the
 * words. A bundle id has no `_`, so the id has none.
 */
export function appProfileIdFromName(name: string): string {
  const id = name
    .replace(/\borca\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || 'profile'
}

/** The renderer's translate. The CLI uses the English text. */
export type RuleTranslate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>
) => string

const english: RuleTranslate = (_key, fallback, values) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))

/** Null when the id is valid and free. The check ignores case, as APFS and bundle ids do. */
export function appProfileIdError(
  id: string,
  takenIds: readonly string[],
  t: RuleTranslate = english
): string | null {
  if (!ID_PATTERN.test(id)) {
    return t(
      'profileManager.rule.idPattern',
      'Use 1 to 32 letters, digits and -, with a letter or digit first.'
    )
  }
  const lower = id.toLowerCase()
  if (RESERVED_IDS.includes(lower)) {
    return t('profileManager.rule.idReserved', 'The id "{{id}}" is reserved.', { id })
  }
  if (takenIds.some((taken) => taken.toLowerCase() === lower)) {
    return t('profileManager.rule.idTaken', 'A profile with the id "{{id}}" exists.', { id })
  }
  return null
}

/** The longest profile name in UTF-8 bytes: its helper apps carry it in their file names. */
export const APP_PROFILE_NAME_MAX_BYTES = 200

/**
 * Null when the name can be the app's file name and no other profile has it. A name that starts
 * with "-" would be read as an option of `orca profiles`.
 */
export function appProfileNameError(
  name: string,
  takenNames: readonly string[],
  t: RuleTranslate = english
): string | null {
  const trimmed = name.trim()
  if (!trimmed || /^[.-]/.test(trimmed) || /[/:]/.test(trimmed)) {
    return t(
      'profileManager.rule.nameChars',
      'Type a name without "/" or ":", and with no "." or "-" first.'
    )
  }
  // "<name> Helper (Renderer).app" must fit in a file name (255 bytes).
  if (new TextEncoder().encode(trimmed).length > APP_PROFILE_NAME_MAX_BYTES) {
    return t(
      'profileManager.rule.nameLong',
      'The profile name is too long: at most {{max}} bytes.',
      {
        max: APP_PROFILE_NAME_MAX_BYTES
      }
    )
  }
  const lower = trimmed.toLowerCase()
  if (takenNames.some((taken) => taken.toLowerCase() === lower)) {
    return t('profileManager.rule.nameTaken', 'A profile with the name "{{name}}" exists.', {
      name: trimmed
    })
  }
  return null
}

function portRangeError(port: number, t: RuleTranslate): string | null {
  return !Number.isInteger(port) || port < 1024 || port > 65535
    ? t('profileManager.rule.portRange', 'The port must be 1024 to 65535: {{port}}', { port })
    : null
}

/**
 * Null when the port is valid, is not the default app's saved port, and is outside the port
 * range of other profiles. A range is a port and its fallback ladder of the next 31 ports.
 * Ports near the default app's give only a warning: appPortWarning.
 */
export function appProfilePortError(
  port: number,
  otherPorts: readonly number[],
  t: RuleTranslate = english,
  defaultPort = DEFAULT_APP_PORT
): string | null {
  const range = portRangeError(port, t)
  if (range) {
    return range
  }
  const clash =
    port === defaultPort || otherPorts.some((other) => Math.abs(other - port) < PORT_SPACING)
  return clash
    ? t(
        'profileManager.rule.portClash',
        'The port {{port}} is inside the port range of the default app or of another profile.',
        { port }
      )
    : null
}

/** Null when the default app can save the port: valid, and no profile saves it. */
export function defaultAppPortError(
  port: number,
  profilePorts: readonly number[],
  t: RuleTranslate = english
): string | null {
  return (
    portRangeError(port, t) ??
    (profilePorts.includes(port)
      ? t('profileManager.rule.portTaken', 'Another profile saves the port {{port}}.', { port })
      : null)
  )
}

/**
 * A warning for a saved port that another Orca can take first, or null. Desktop apps listen on
 * 6768 and its ladder. `nearPorts`: the saved ports of the other apps (both ways: a profile
 * gives the default app's port, the default app gives the profiles' ports).
 */
export function appPortWarning(
  port: number,
  nearPorts: readonly number[],
  t: RuleTranslate = english
): string | null {
  if (port >= DEFAULT_APP_PORT && port < DEFAULT_APP_PORT + PORT_SPACING) {
    return t(
      'profileManager.rule.portDesktop',
      'Orca desktop apps also use the ports 6768 to 6799. A running desktop app can take this port first.'
    )
  }
  return nearPorts.some((other) => other !== port && Math.abs(other - port) < PORT_SPACING)
    ? t(
        'profileManager.rule.portNear',
        'The server of another Orca app can use the 31 ports after its own. It can take this port first.'
      )
    : null
}

/** The first port of the 6800, 6832, … series that no profile uses. */
export function nextAppProfilePort(ports: readonly number[]): number {
  let port = PROFILE_PORT_BASE
  while (ports.some((other) => Math.abs(other - port) < PORT_SPACING)) {
    port += PORT_SPACING
  }
  return port
}
