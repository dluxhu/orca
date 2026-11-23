// Names, ids and ports of app profiles: docs/fork/profiles-design.md, sections 4 and 9.
// The CLI applies these rules. The Profile Manager shows the same errors before it calls the CLI.

// The default app uses 6768 and its fallback ladder up to 6799.
const DEFAULT_APP_PORTS = { first: 6768, last: 6799 }
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
  port: number
  state: AppProfileState
}

/** What the Profile Manager window gets from the main process. */
export type AppProfilesState = {
  rows: AppProfileRow[]
  /** The id of the app that shows the Profile Manager. */
  currentId: string
  /** Ids of data folders that "Keep data" left. A new profile with such an id uses the folder. */
  keptIds: string[]
}

/** One change that the Profile Manager asks for. The main process runs `orca profiles` for it. */
export type AppProfileChange =
  | { kind: 'create'; name: string; id: string; port: number; copySettings: boolean }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'set-port'; id: string; port: number }
  | { kind: 'remove'; id: string; keepData: boolean }

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

/** Null when the id is valid and free. The check ignores case, as APFS and bundle ids do. */
export function appProfileIdError(id: string, takenIds: readonly string[]): string | null {
  if (!ID_PATTERN.test(id)) {
    return 'Use 1 to 32 letters, digits and -, with a letter or digit first.'
  }
  const lower = id.toLowerCase()
  if (RESERVED_IDS.includes(lower)) {
    return `The id "${id}" is reserved.`
  }
  if (takenIds.some((taken) => taken.toLowerCase() === lower)) {
    return `A profile with the id "${id}" exists.`
  }
  return null
}

/** Null when the name can be the app's file name and no other profile has it. */
export function appProfileNameError(name: string, takenNames: readonly string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed.startsWith('.') || /[/:]/.test(trimmed)) {
    return 'Type a name without "/" or ":".'
  }
  const lower = trimmed.toLowerCase()
  if (takenNames.some((taken) => taken.toLowerCase() === lower)) {
    return `A profile with the name "${trimmed}" exists.`
  }
  return null
}

/** Null when the port is valid and outside the port range of the default app and of other profiles. */
export function appProfilePortError(port: number, otherPorts: readonly number[]): string | null {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return `The port must be 1024 to 65535: ${port}`
  }
  const clash =
    (port >= DEFAULT_APP_PORTS.first && port <= DEFAULT_APP_PORTS.last) ||
    otherPorts.some((other) => Math.abs(other - port) < PORT_SPACING)
  return clash
    ? `The port ${port} is inside the port range of the default app or of another profile.`
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
