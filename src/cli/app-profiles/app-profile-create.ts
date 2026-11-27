// `orca profiles create <name> [--port N]`: makes the thin profile bundle of
// docs/fork/profiles-design.md, sections 1 and 2. Hidden while profiles are a prototype.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  APP_PROFILE_PLIST_ID_KEY,
  APP_PROFILES_REGISTRY,
  appProfilesAppsDir,
  appProfilesRoot,
  ensureAppProfileMarker,
  readAppProfileRegistry,
  readPlistString,
  type AppProfileEntry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { getMacAppBundlePath } from '../runtime/serve/updates/mac-app-update-bundle'
import { getPackagedElectronExecutable } from '../runtime/app-launch/packaged-cli-interpreter'
import { RuntimeClientError } from '../runtime/connection/types'
import { buildProfileBundle } from './app-profile-bundle'

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
// The default app uses 6768 and its fallback ladder up to 6799.
const DEFAULT_APP_PORTS = { first: 6768, last: 6799 }
const PROFILE_PORT_BASE = 6800
const PORT_SPACING = 32

/** The longest profile name in UTF-8 bytes: its helper apps carry it in their file names. */
export const APP_PROFILE_NAME_MAX_BYTES = 200

/** Runs a tool and returns its stdout; throws when it fails. */
export type RunTool = (program: string, args: string[]) => string

export const runTool: RunTool = (program, args) =>
  execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export type CreateAppProfileOptions = {
  name: string
  port?: number
  defaultAppPath: string
  /** Test runs only: write the profiles root into Info.plist, so a Dock launch finds a test root. */
  pinRoot?: boolean
  env?: NodeJS.ProcessEnv
  home?: string
  run?: RunTool
  now?: () => number
}

export function appProfileIdFromName(name: string): string {
  return (
    name
      .toLowerCase()
      // A bundle id has no `_`, so `a_b` and `a-b` are one id.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

/** The first port of the 6800, 6832, … series that no profile uses. */
export function nextAppProfilePort(profiles: readonly AppProfileEntry[]): number {
  let port = PROFILE_PORT_BASE
  while (profiles.some((profile) => Math.abs(profile.port - port) < PORT_SPACING)) {
    port += PORT_SPACING
  }
  return port
}

function validatePort(port: number, profiles: readonly AppProfileEntry[]): void {
  const inLadder = (base: number, last: number): boolean => port >= base && port <= last
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RuntimeClientError('invalid_argument', `--port must be 1024 to 65535: ${port}`)
  }
  const clash =
    inLadder(DEFAULT_APP_PORTS.first, DEFAULT_APP_PORTS.last) ||
    profiles.some((profile) => Math.abs(profile.port - port) < PORT_SPACING)
  if (clash) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--port ${port} is inside the port range of the default app or of another profile.`
    )
  }
}

/** Builds and signs the profile app, writes its marker and adds it to profiles.json. */
export function createAppProfile(options: CreateAppProfileOptions): AppProfileEntry {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const run = options.run ?? runTool
  const name = options.name.trim()
  const id = appProfileIdFromName(name)
  if (!name || !id || name.includes('/')) {
    throw new RuntimeClientError('invalid_argument', `Not a profile name: "${options.name}"`)
  }
  // "<name> Helper (Renderer).app" must fit in a file name (255 bytes).
  if (Buffer.byteLength(name) > APP_PROFILE_NAME_MAX_BYTES) {
    throw new RuntimeClientError(
      'invalid_argument',
      `The profile name is too long: at most ${APP_PROFILE_NAME_MAX_BYTES} bytes.`
    )
  }
  const root = resolve(appProfilesRoot(env, home))
  const appsDir = resolve(appProfilesAppsDir(env, home))
  const defaultApp = defaultAppOf(resolve(options.defaultAppPath))
  mkdirSync(root, { recursive: true })
  mkdirSync(appsDir, { recursive: true })

  return withRegistryLock(root, () => {
    const registry: AppProfileRegistry = readAppProfileRegistry(root) ?? {
      version: 1,
      defaultAppPath: defaultApp,
      urlHandler: { mode: 'ask' },
      profiles: []
    }
    if (registry.profiles.some((profile) => profile.id === id)) {
      throw new RuntimeClientError('invalid_argument', `The profile "${id}" exists.`)
    }
    const port = options.port ?? nextAppProfilePort(registry.profiles)
    validatePort(port, registry.profiles)
    const appPath = join(appsDir, `${name}.app`)
    if (existsSync(appPath)) {
      throw new RuntimeClientError('invalid_argument', `${appPath} exists.`)
    }
    // Build in a temporary folder and move the bundle in place when it is complete.
    const staging = mkdtempSync(join(appsDir, `.${id}.staging-`))
    try {
      const bundle = join(staging, `${name}.app`)
      const pinnedRoot = options.pinRoot ? root : undefined
      const { bundleId } = buildProfileBundle(
        defaultApp,
        bundle,
        { id, name, root: pinnedRoot },
        run,
        staging
      )
      // The marker comes first: a launchable app always finds its profile. A later failure
      // removes the app, so a retry with the same name works.
      const userDataPath = join(root, id)
      ensureAppProfileMarker(userDataPath, id)
      const entry: AppProfileEntry = {
        id,
        name,
        bundleId,
        appPath,
        userDataPath,
        port,
        createdAt: (options.now ?? Date.now)()
      }
      renameSync(bundle, appPath)
      try {
        run(LSREGISTER, ['-f', appPath])
        writeRegistry(root, { ...registry, profiles: [...registry.profiles, entry] })
      } catch (error) {
        rmSync(appPath, { recursive: true, force: true })
        throw error
      }
      return entry
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  })
}

/**
 * A profile's `orca` runs in the profile app; its app.asar.unpacked link points into the default
 * app. Not the app.asar link: Electron 45 reads no asar archive through a link (EINVAL).
 */
export function defaultAppOf(appPath: string): string {
  const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  if (readPlistString(plist, APP_PROFILE_PLIST_ID_KEY) === null) {
    return appPath
  }
  return resolve(
    realpathSync(join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')),
    '..',
    '..',
    '..'
  )
}

function writeRegistry(root: string, registry: AppProfileRegistry): void {
  const path = join(root, APP_PROFILES_REGISTRY)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`)
  renameSync(temporary, path)
}

// shortcut: a lock that a crashed writer leaves stops later writers; add stale-lock removal with the Profile Manager.
function withRegistryLock<T>(root: string, body: () => T): T {
  const lock = join(root, `${APP_PROFILES_REGISTRY}.lock`)
  let fd: number
  try {
    fd = openSync(lock, 'wx')
  } catch {
    throw new RuntimeClientError(
      'invalid_argument',
      `Another process changes the profiles now (${lock}). Remove the file if no process does.`
    )
  }
  try {
    return body()
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}

/** The CLI entry: `orca profiles create <name> [--port N]`. */
export function runProfilesCreate(argv: string[]): void {
  // --pin-root: test runs with ORCA_PROFILES_ROOT; an inherited root must not stick in a bundle.
  const pinRoot = argv.includes('--pin-root')
  const args = argv.filter((arg) => arg !== '--pin-root')
  const portIndex = args.indexOf('--port')
  const port = portIndex === -1 ? undefined : Number(args[portIndex + 1])
  const rest =
    portIndex === -1 ? args : args.filter((_, i) => i !== portIndex && i !== portIndex + 1)
  if (rest.length !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Usage: orca profiles create <name> [--port N]'
    )
  }
  if (process.platform !== 'darwin') {
    throw new RuntimeClientError('unsupported_platform', 'Profiles are only on macOS.')
  }
  // On the bundled Node, the launcher names the app executable.
  const executable = getPackagedElectronExecutable() ?? process.execPath
  const defaultAppPath = getMacAppBundlePath(executable)
  if (!defaultAppPath) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Run this command with the orca CLI of an Orca app.'
    )
  }
  const entry = createAppProfile({ name: rest[0], port, defaultAppPath, pinRoot })
  process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
}
