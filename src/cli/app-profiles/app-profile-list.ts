// `orca profiles list`: every profile with its state. See docs/fork/profiles-design.md, section 4.
// The main process imports this module for the Profiles menu, so it has no CLI-only imports.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  appProfilesRoot,
  locateAppProfileApp,
  readAppProfileRegistry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import {
  DEFAULT_APP_PORT,
  type AppProfileRow,
  type AppProfileState
} from '../../shared/app-profiles/app-profile-rules'
import {
  findTransport,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import {
  SERVE_LAUNCHD_LABEL_PREFIX,
  serveProfileSuffix
} from '../../shared/remote-runtime/serve-supervisor/serve-bundle-coordination'
import {
  runServeServiceManager,
  type ServeServiceRun
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { isProcessAlive } from './app-profile-registry'
import { readOrcadInstanceLockRecord } from '../../main/orcad/instance-lock/orcad-instance-lock-record'

// ORCAD_LOCK_FILE_NAME: that module brings the whole lock code.
const ORCAD_LOCK_FILE = 'orcad.lock'

export type AppProfileListDeps = {
  env?: NodeJS.ProcessEnv
  home?: string
  uid?: number
  serviceRun?: ServeServiceRun
  isAlive?: (pid: number) => boolean
}

/** The LaunchAgent of `orca serve service install` for this userData. */
export function serveServiceUnitOf(
  userDataPath: string,
  isDefault: boolean,
  home: string
): { label: string; unitPath: string } {
  const label = isDefault
    ? SERVE_LAUNCHD_LABEL_PREFIX
    : `${SERVE_LAUNCHD_LABEL_PREFIX}.${serveProfileSuffix(userDataPath)}`
  return { label, unitPath: join(home, 'Library', 'LaunchAgents', `${label}.plist`) }
}

/** The pid of the loaded serve service job, or null when it is not loaded or has no process. */
export async function readServeServicePid(
  label: string,
  deps: { uid: number; run: ServeServiceRun }
): Promise<number | null> {
  const result = await deps.run('launchctl', ['print', `gui/${deps.uid}/${label}`])
  if (result.code !== 0) {
    return null
  }
  return Number(/^\s*pid = (\d+)/m.exec(result.out)?.[1] ?? 0) || null
}

/** The profile's runtime file, or null when it is missing or has no pid. */
function readRuntime(userDataPath: string): RuntimeMetadata | null {
  try {
    const runtime = JSON.parse(readFileSync(getRuntimeMetadataPath(userDataPath), 'utf8')) as
      | RuntimeMetadata
      | undefined
    return typeof runtime?.pid === 'number' && runtime.pid > 0 ? runtime : null
  } catch {
    return null
  }
}

/** Who owns the profile's runtime file. */
export type RuntimeOwner =
  /** No live process of this profile: a stale file, or a pid that another process took. */
  | 'none'
  | 'app'
  /** A server of the profile that its own serve service did not start. */
  | 'server'
  /** The server of the profile's own serve service. */
  | 'service'

export type AppProfileRuntime = {
  state: AppProfileState
  owner: RuntimeOwner
  /** The port of the owner's WebSocket listener, as pairing advertises it. */
  livePort: number | null
}

type ProcessRow = { ppid: number; command: string }

async function readProcess(pid: number, run: ServeServiceRun): Promise<ProcessRow | null> {
  const result = await run('/bin/ps', ['-o', 'ppid=,command=', '-p', String(pid)])
  const match = result.code === 0 ? /^\s*(\d+)\s+(.+)$/s.exec(result.out) : null
  return match ? { ppid: Number(match[1]), command: match[2].trim() } : null
}

// The service job is the server's supervisor: its parent, or a few levels up.
const SERVICE_DEPTH = 3

async function classifyOwner(
  pid: number,
  profile: { userDataPath: string; appPath: string },
  servicePid: number | null,
  run: ServeServiceRun
): Promise<RuntimeOwner> {
  const row = await readProcess(pid, run)
  if (!row) {
    return 'none'
  }
  const lock = readOrcadInstanceLockRecord(join(profile.userDataPath, ORCAD_LOCK_FILE))
  // An Electron serve takes the desktop role; only orcad holds the orcad role.
  const orcad = lock?.pid === pid && lock.role !== 'desktop'
  const command = ` ${row.command} `
  const ours =
    orcad ||
    command.startsWith(` ${profile.appPath}/Contents/`) ||
    command.includes(` --user-data-dir=${profile.userDataPath} `)
  if (!ours) {
    return 'none'
  }
  let current = pid
  let parent: ProcessRow | null = row
  for (let depth = 0; servicePid !== null && depth <= SERVICE_DEPTH; depth++) {
    if (current === servicePid) {
      return 'service'
    }
    if (!parent || parent.ppid <= 1) {
      break
    }
    current = parent.ppid
    parent = await readProcess(current, run)
  }
  // `orca serve` starts the Electron server with a --serve token (not --serve-port).
  return orcad || command.includes(' --serve ') ? 'server' : 'app'
}

function webSocketPort(runtime: RuntimeMetadata): number | null {
  const endpoint = findTransport(runtime, 'websocket')?.endpoint ?? ''
  const port = Number(/:(\d+)$/.exec(endpoint)?.[1])
  return port > 0 ? port : null
}

/**
 * The owner of the profile's runtime, its state and its live port.
 * "running": the profile app. "background": only a server runs: the serve service, or a server
 * that another launch agent or a terminal started. "stopped": neither runs.
 */
export async function readAppProfileRuntime(
  profile: { userDataPath: string; appPath: string },
  isDefault: boolean,
  deps: AppProfileListDeps = {}
): Promise<AppProfileRuntime> {
  const isAlive = deps.isAlive ?? isProcessAlive
  const { label } = serveServiceUnitOf(profile.userDataPath, isDefault, deps.home ?? homedir())
  const run = deps.serviceRun ?? runServeServiceManager
  const servicePid = await readServeServicePid(label, {
    uid: deps.uid ?? process.getuid?.() ?? 0,
    run
  })
  const runtime = readRuntime(profile.userDataPath)
  const owner =
    runtime && isAlive(runtime.pid)
      ? await classifyOwner(runtime.pid, profile, servicePid, run)
      : 'none'
  const serviceRuns = servicePid !== null && isAlive(servicePid)
  return {
    state: owner === 'app' ? 'running' : owner !== 'none' || serviceRuns ? 'background' : 'stopped',
    owner,
    livePort: runtime && owner !== 'none' ? webSocketPort(runtime) : null
  }
}

/** The default app first, then the profiles in the registry order. */
export async function listAppProfiles(
  options: { defaultAppPath: string; defaultUserDataPath: string } & AppProfileListDeps
): Promise<AppProfileRow[]> {
  const registry: AppProfileRegistry | null = readAppProfileRegistry(
    appProfilesRoot(options.env ?? process.env, options.home ?? homedir())
  )
  const defaultAppPath = registry?.defaultAppPath ?? options.defaultAppPath
  const rows: Omit<AppProfileRow, 'state' | 'startAtLogin'>[] = [
    {
      id: 'default',
      // The plain app is the "Default" entry. Its data stays where the app keeps it.
      name: 'Default',
      appPath: defaultAppPath,
      userDataPath: options.defaultUserDataPath,
      port: registry?.defaultPort ?? DEFAULT_APP_PORT
    },
    ...(registry?.profiles ?? []).map(({ id, name, appPath, userDataPath, port }) => {
      // A rename in Finder changes only the file name; the app shows that name.
      const found = locateAppProfileApp({ id, appPath })
      return {
        id,
        name: found ? basename(found, '.app') : name,
        appPath: found ?? appPath,
        userDataPath,
        port
      }
    })
  ]
  const home = options.home ?? homedir()
  return Promise.all(
    rows.map(async (row) => {
      const { state, livePort } = await readAppProfileRuntime(row, row.id === 'default', options)
      return {
        ...row,
        ...(livePort === null ? {} : { livePort }),
        state,
        startAtLogin: existsSync(
          serveServiceUnitOf(row.userDataPath, row.id === 'default', home).unitPath
        )
      }
    })
  )
}
