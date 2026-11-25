// `orca profiles set-port default`: the saved port of the default app (profiles.json defaultPort).
// `orca serve` without --port uses it. Without it, the default app uses DEFAULT_WS_PORT.
import { homedir } from 'node:os'
import {
  appProfilesRoot,
  readAppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { appPortWarning, defaultAppPortError } from '../../shared/app-profiles/app-profile-rules'
import { runServeServiceManager } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { RuntimeClientError } from '../runtime/connection/types'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import { runTool } from './app-profile-create'
import {
  movePort,
  refuseOtherServer,
  type EditAppProfileOptions,
  type ServeServiceChange
} from './app-profile-edit'
import { readAppProfileRuntime, serveServiceUnitOf } from './app-profile-list'
import { withRegistryLockAsync, writeRegistry } from './app-profile-registry'

export async function setDefaultAppPort(
  options: Omit<EditAppProfileOptions, 'id'> & { port: number; defaultUserDataPath?: string }
): Promise<{
  id: 'default'
  port: number
  /** appPortWarning of the port. */
  warning: string | null
  serveServiceInstalled: boolean
  serveService: ServeServiceChange
}> {
  const home = options.home ?? homedir()
  const root = appProfilesRoot(options.env ?? process.env, home)
  return withRegistryLockAsync(root, async () => {
    const registry = readAppProfileRegistry(root)
    if (!registry) {
      throw new RuntimeClientError(
        'invalid_argument',
        'There are no profiles, so the default app keeps its built-in port.'
      )
    }
    const error = defaultAppPortError(
      options.port,
      registry.profiles.map((profile) => profile.port)
    )
    if (error) {
      throw new RuntimeClientError('invalid_argument', error)
    }
    const userDataPath = options.defaultUserDataPath ?? getPlatformUserDataPath()
    const uid = options.uid ?? process.getuid?.() ?? 0
    const serviceRun = options.serviceRun ?? runServeServiceManager
    const unit = serveServiceUnitOf(userDataPath, true, home)
    const { owner, serverWindow } = await readAppProfileRuntime({ userDataPath }, true, {
      home,
      uid,
      serviceRun,
      isAlive: options.isAlive
    })
    refuseOtherServer(owner, 'Default', 'edit')
    // A server with a window keeps running; its unit gets the port for its next start.
    const loaded =
      !serverWindow &&
      (await serviceRun('launchctl', ['print', `gui/${uid}/${unit.label}`])).code === 0
    const port = options.port
    const moved = movePort({ run: options.run ?? runTool, uid, unit, loaded, port }, () =>
      writeRegistry(root, { ...registry, defaultPort: port })
    )
    const warning = appPortWarning(
      port,
      registry.profiles.map((profile) => profile.port)
    )
    return { id: 'default', port, warning, ...moved }
  })
}
