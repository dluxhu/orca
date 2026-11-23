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
import type { AppProfileRow, AppProfileState } from '../../shared/app-profiles/app-profile-rules'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'
import {
  SERVE_LAUNCHD_LABEL_PREFIX,
  serveProfileSuffix
} from '../../shared/remote-runtime/serve-supervisor/serve-bundle-coordination'
import {
  runServeServiceManager,
  type ServeServiceRun
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { isProcessAlive } from './app-profile-registry'

/** The default profile's port (DEFAULT_WS_PORT). */
const DEFAULT_APP_PORT = 6768

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

function runtimePid(userDataPath: string): number | null {
  try {
    const pid = (
      JSON.parse(readFileSync(getRuntimeMetadataPath(userDataPath), 'utf8')) as {
        pid?: unknown
      }
    ).pid
    return typeof pid === 'number' && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * "running": an Orca process other than the serve service owns the profile's runtime.
 * "background": only the serve service runs. "stopped": neither runs.
 */
export async function readAppProfileState(
  userDataPath: string,
  isDefault: boolean,
  deps: AppProfileListDeps = {}
): Promise<AppProfileState> {
  const isAlive = deps.isAlive ?? isProcessAlive
  const { label } = serveServiceUnitOf(userDataPath, isDefault, deps.home ?? homedir())
  const servicePid = await readServeServicePid(label, {
    uid: deps.uid ?? process.getuid?.() ?? 0,
    run: deps.serviceRun ?? runServeServiceManager
  })
  const pid = runtimePid(userDataPath)
  if (pid !== null && pid !== servicePid && isAlive(pid)) {
    return 'running'
  }
  return servicePid !== null && isAlive(servicePid) ? 'background' : 'stopped'
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
      port: DEFAULT_APP_PORT
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
    rows.map(async (row) => ({
      ...row,
      state: await readAppProfileState(row.userDataPath, row.id === 'default', options),
      startAtLogin: existsSync(
        serveServiceUnitOf(row.userDataPath, row.id === 'default', home).unitPath
      )
    }))
  )
}
