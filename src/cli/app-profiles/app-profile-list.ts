// `orca profiles list`: every profile with its state. See docs/fork/profiles-design.md, section 4.
// The main process imports this module for the Profiles menu, so it has no CLI-only imports.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  appProfilesRoot,
  locateAppProfileApp,
  readAppProfileRegistry,
  serveUnitCopyPath,
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

export type AppProfileListDeps = {
  env?: NodeJS.ProcessEnv
  home?: string
  uid?: number
  serviceRun?: ServeServiceRun
  isAlive?: (pid: number) => boolean
}

export type ServeServiceUnit = {
  label: string
  /** The LaunchAgent: its file is the login item. */
  unitPath: string
  /** The unit that `serve service uninstall --keep-running` keeps for a job without a login item. */
  copyPath: string
}

/** The LaunchAgent of `orca serve service install` for this userData. */
export function serveServiceUnitOf(
  userDataPath: string,
  isDefault: boolean,
  home: string
): ServeServiceUnit {
  const label = isDefault
    ? SERVE_LAUNCHD_LABEL_PREFIX
    : `${SERVE_LAUNCHD_LABEL_PREFIX}.${serveProfileSuffix(userDataPath)}`
  const unitPath = join(home, 'Library', 'LaunchAgents', `${label}.plist`)
  return { label, unitPath, copyPath: serveUnitCopyPath(userDataPath) }
}

/** The file that loads the job: the LaunchAgent, else its copy. */
export function serveJobFileOf(unit: ServeServiceUnit): string {
  return existsSync(unit.unitPath) ? unit.unitPath : unit.copyPath
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

/** The profile's runtime file and its write time, or null when it is missing or has no pid. */
function readRuntime(userDataPath: string): { runtime: RuntimeMetadata; writtenAt: number } | null {
  try {
    const path = getRuntimeMetadataPath(userDataPath)
    const runtime = JSON.parse(readFileSync(path, 'utf8')) as RuntimeMetadata | undefined
    return typeof runtime?.pid === 'number' && runtime.pid > 0
      ? { runtime, writtenAt: statSync(path).mtimeMs }
      : null
  } catch {
    return null
  }
}

/** Who owns the profile's runtime file. */
export type RuntimeOwner =
  /** No live owner: no file, a dead pid, or a pid that a later process took. */
  | 'none'
  | 'app'
  /** A server of the profile that its own serve service did not start. */
  | 'server'
  /** The server of the profile's own serve service. */
  | 'service'

export type AppProfileRuntime = {
  state: AppProfileState
  owner: RuntimeOwner
  /** A server owns the runtime and shows a desktop window: a Dock click on the app opened it. */
  serverWindow: boolean
  /** The profile's own serve service job runs. */
  serviceRuns: boolean
  /** The port of the owner's WebSocket listener, as pairing advertises it. */
  livePort: number | null
}

/** `ps` elapsed time: [[dd-]hh:]mm:ss. */
function elapsedMs(etime: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime)
  if (!match) {
    return null
  }
  const [, days = '0', hours = '0', minutes, seconds] = match
  return (
    (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000
  )
}

type ProcessRow = { ppid: number; startedAt: number | null }

async function readProcess(pid: number, run: ServeServiceRun): Promise<ProcessRow | null> {
  const result = await run('/bin/ps', ['-o', 'ppid=,etime=', '-p', String(pid)])
  const match = result.code === 0 ? /^\s*(\d+)\s+(\S+)\s*$/.exec(result.out) : null
  if (!match) {
    return null
  }
  const elapsed = elapsedMs(match[2])
  return { ppid: Number(match[1]), startedAt: elapsed === null ? null : Date.now() - elapsed }
}

// `ps` gives whole seconds, so the computed start can be up to a second late.
const START_SLACK_MS = 2000
// The service job is the server's supervisor: its parent, or a few levels up.
const SERVICE_DEPTH = 3

/**
 * The owner from the runtime file, which its owner writes: its role, and the pid. A pid that
 * started after the file was written belongs to another process. A file without a role (an
 * older version) is the app, so that no edit removes a running app's data.
 */
async function classifyOwner(
  file: { runtime: RuntimeMetadata; writtenAt: number },
  servicePid: number | null,
  run: ServeServiceRun
): Promise<RuntimeOwner> {
  const { pid } = file.runtime
  const row = await readProcess(pid, run)
  if (row?.startedAt != null && row.startedAt > file.writtenAt + START_SLACK_MS) {
    return 'none'
  }
  let current = pid
  let parent = row
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
  return file.runtime.role === 'serve' || file.runtime.role === 'orcad' ? 'server' : 'app'
}

/** True when the process has a Dock tile: a server gets one while it shows a desktop window. */
async function hasDockTile(pid: number, run: ServeServiceRun): Promise<boolean> {
  const result = await run('/usr/bin/lsappinfo', ['info', '-only', 'ApplicationType', String(pid)])
  return result.code === 0 && /type="Foreground"/.test(result.out)
}

function webSocketPort(runtime: RuntimeMetadata): number | null {
  const endpoint = findTransport(runtime, 'websocket')?.endpoint ?? ''
  const port = Number(/:(\d+)$/.exec(endpoint)?.[1])
  return port > 0 ? port : null
}

/**
 * The owner of the profile's runtime, its state and its live port.
 * "running": the profile app, or a server that shows a desktop window. "background": only a server
 * runs: the serve service, or a server that another launch agent or a terminal started.
 * "stopped": neither runs.
 */
export async function readAppProfileRuntime(
  profile: { userDataPath: string },
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
  const file = readRuntime(profile.userDataPath)
  const owner =
    file && isAlive(file.runtime.pid) ? await classifyOwner(file, servicePid, run) : 'none'
  const serviceRuns = servicePid !== null && isAlive(servicePid)
  // A Dock click on a profile app whose server runs activates that server, which opens a window.
  const serverWindow =
    file !== null && (owner === 'server' || owner === 'service')
      ? await hasDockTile(file.runtime.pid, run)
      : false
  return {
    state:
      owner === 'app' || serverWindow
        ? 'running'
        : owner !== 'none' || serviceRuns
          ? 'background'
          : 'stopped',
    owner,
    serverWindow,
    serviceRuns,
    livePort: file && owner !== 'none' ? webSocketPort(file.runtime) : null
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
    ...(registry?.profiles ?? []).map(({ id, name, appPath, userDataPath, port, icon }) => {
      // A rename in Finder changes only the file name; the app shows that name.
      const found = locateAppProfileApp({ id, appPath })
      return {
        id,
        name: found ? basename(found, '.app') : name,
        appPath: found ?? appPath,
        userDataPath,
        port,
        icon
      }
    })
  ]
  const home = options.home ?? homedir()
  return Promise.all(
    rows.map(async (row) => {
      const { state, livePort, serviceRuns } = await readAppProfileRuntime(
        row,
        row.id === 'default',
        options
      )
      return {
        ...row,
        ...(livePort === null ? {} : { livePort }),
        state,
        serviceRuns,
        startAtLogin: existsSync(
          serveServiceUnitOf(row.userDataPath, row.id === 'default', home).unitPath
        )
      }
    })
  )
}
