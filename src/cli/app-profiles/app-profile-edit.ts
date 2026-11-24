// Rename and port change of a profile: docs/fork/profiles-design.md, section 9.
// app-profile-remove.ts uses the shared steps here (lock, state check, registry write).
import { existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  appProfilesAppsDir,
  appProfilesRoot,
  locateAppProfileApp,
  readAppProfileRegistry,
  type AppProfileEntry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import {
  appProfileNameError,
  appProfilePortError
} from '../../shared/app-profiles/app-profile-rules'
import {
  runServeServiceManager,
  type ServeServiceRun
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { RuntimeClientError } from '../runtime/connection/types'
import { LSREGISTER, runTool, type RunTool } from './app-profile-create'
import { readAppProfileState, serveServiceUnitOf } from './app-profile-list'
import {
  rewriteServeUnitAppPath,
  rewriteServeUnitPort,
  withRegistryLockAsync,
  writeRegistry
} from './app-profile-registry'

export type EditAppProfileOptions = {
  id: string
  env?: NodeJS.ProcessEnv
  home?: string
  uid?: number
  run?: RunTool
  /** Reads the serve service state (launchctl print). */
  serviceRun?: ServeServiceRun
  isAlive?: (pid: number) => boolean
}

/** What happened to the profile's own serve service (`orca serve service install`). */
export type ServeServiceChange = 'none' | 'updated' | 'restarted' | 'removed'

export type Context = {
  root: string
  appsDir: string
  home: string
  uid: number
  run: RunTool
  entry: AppProfileEntry
  /** The app with this profile's embedded id, or null when it is missing. */
  located: string | null
  registry: AppProfileRegistry
  /** True when the serve service runs and the app does not. */
  inBackground: boolean
}

/** The root of the profiles. The default app is not a profile, so no edit takes it. */
export function rootOf(options: EditAppProfileOptions, action: string): string {
  if (options.id.toLowerCase() === 'default') {
    throw new RuntimeClientError(
      'invalid_argument',
      `The default app is not a profile: Orca does not ${action} it. Its data stays where it is.`
    )
  }
  return appProfilesRoot(options.env ?? process.env, options.home ?? homedir())
}

/**
 * Finds the profile and refuses while its app (or a serve that is not the service) runs. The
 * caller holds the registry lock and changes nothing between this check and its change.
 */
export async function prepare(options: EditAppProfileOptions, action: string): Promise<Context> {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const root = appProfilesRoot(env, home)
  const registry = readAppProfileRegistry(root)
  const found = registry?.profiles.find((profile) => profile.id === options.id)
  if (!registry || !found) {
    const ids = registry?.profiles.map((profile) => profile.id).join(', ') || 'none'
    throw new RuntimeClientError(
      'invalid_argument',
      `No profile "${options.id}". Profiles: ${ids}.`
    )
  }
  // A rename in Finder leaves the registry path behind; the embedded id finds the app.
  const located = locateAppProfileApp(found)
  const entry = { ...found, appPath: located ?? found.appPath }
  const state = await readAppProfileState(entry.userDataPath, false, {
    home,
    uid: options.uid,
    serviceRun: options.serviceRun,
    isAlive: options.isAlive
  })
  if (state === 'running') {
    throw new RuntimeClientError(
      'profile_running',
      `"${entry.name}" runs. Quit it, and stop its server, before you ${action} it.`
    )
  }
  return {
    root,
    appsDir: resolve(appProfilesAppsDir(env, home)),
    home,
    uid: options.uid ?? process.getuid?.() ?? 0,
    run: options.run ?? runTool,
    entry,
    located,
    registry,
    inBackground: state === 'background'
  }
}

export function tryRun(run: RunTool, program: string, args: string[]): void {
  try {
    run(program, args)
  } catch {
    // Best effort: the item is already gone or was never there.
  }
}

/** Profile changes go to the registry entry with this id, under the lock. */
export function updateEntry(
  context: Context,
  change: (registry: AppProfileRegistry) => AppProfileRegistry
): void {
  const current = readAppProfileRegistry(context.root) ?? context.registry
  writeRegistry(context.root, change(current))
}

/**
 * Changes the name only: the app file name and the registry name. The id, the bundle id, the data
 * folder and the signed bundle contents stay, so the privacy grants and the Keychain access stay.
 */
export async function renameAppProfile(
  options: EditAppProfileOptions & { name: string }
): Promise<AppProfileEntry & { serveService: ServeServiceChange }> {
  return withRegistryLockAsync(rootOf(options, 'rename'), async () => {
    const context = await prepare(options, 'rename')
    return renameLocked(context, options.name)
  })
}

function renameLocked(
  context: Context,
  newName: string
): AppProfileEntry & { serveService: ServeServiceChange } {
  const { entry, run } = context
  const name = newName.trim()
  const error = appProfileNameError(
    name,
    context.registry.profiles.filter((p) => p.id !== entry.id).map((p) => p.name)
  )
  if (error) {
    throw new RuntimeClientError('invalid_argument', error)
  }
  const oldPath = entry.appPath
  const newPath = join(dirname(oldPath), `${name}.app`)
  if (newPath === oldPath && name === entry.name) {
    return { ...entry, serveService: 'none' }
  }
  // A case-only change keeps the same path on the default APFS volume.
  if (newPath.toLowerCase() !== oldPath.toLowerCase() && existsSync(newPath)) {
    throw new RuntimeClientError('invalid_argument', `${newPath} exists.`)
  }
  if (!context.located) {
    throw new RuntimeClientError('invalid_argument', `The app is missing: ${oldPath}`)
  }

  const unit = serveServiceUnitOf(entry.userDataPath, false, context.home)
  const target = `gui/${context.uid}/${unit.label}`
  if (context.inBackground) {
    run('/bin/launchctl', ['bootout', target])
  }
  let serveService: ServeServiceChange = 'none'
  try {
    // Only the bundle moves, as a Finder rename does. Finder and the Dock show the file name. The
    // signed contents stay: a new signature would make the Keychain ask again for the app's keys.
    renameSync(oldPath, newPath)
    try {
      tryRun(run, LSREGISTER, ['-u', oldPath])
      run(LSREGISTER, ['-f', newPath])
      // The unit starts the profile's executable by its path. Only Orca's own unit changes here.
      if (rewriteServeUnitAppPath(unit.unitPath, oldPath, newPath)) {
        serveService = 'updated'
      }
      updateEntry(context, (registry) => ({
        ...registry,
        profiles: registry.profiles.map((profile) =>
          profile.id === entry.id ? { ...profile, name, appPath: newPath } : profile
        )
      }))
    } catch (failure) {
      // Put everything back: the unit, Launch Services and the old name.
      if (serveService === 'updated') {
        try {
          rewriteServeUnitAppPath(unit.unitPath, newPath, oldPath)
        } catch {
          // The error below names the failed step; the unit keeps the new path.
        }
        serveService = 'none'
      }
      // Launch Services registers the bundle that exists: the old path, after the move back.
      tryRun(run, LSREGISTER, ['-u', newPath])
      renameSync(newPath, oldPath)
      tryRun(run, LSREGISTER, ['-f', oldPath])
      throw failure
    }
  } finally {
    if (context.inBackground) {
      tryRun(run, '/bin/launchctl', ['bootstrap', `gui/${context.uid}`, unit.unitPath])
    }
  }
  if (context.inBackground) {
    serveService = 'restarted'
  }
  return { ...entry, name, appPath: newPath, serveService }
}

/** Changes the port of the profile's desktop endpoint and server. */
export async function setAppProfilePort(
  options: EditAppProfileOptions & { port: number }
): Promise<AppProfileEntry & { serveServiceInstalled: boolean; serveService: ServeServiceChange }> {
  return withRegistryLockAsync(rootOf(options, 'edit'), async () => {
    const context = await prepare(options, 'edit')
    const { label } = serveServiceUnitOf(context.entry.userDataPath, false, context.home)
    const run = options.serviceRun ?? runServeServiceManager
    const loaded = (await run('launchctl', ['print', `gui/${context.uid}/${label}`])).code === 0
    return setPortLocked(context, options.port, loaded)
  })
}

function setPortLocked(
  context: Context,
  port: number,
  loaded: boolean
): AppProfileEntry & { serveServiceInstalled: boolean; serveService: ServeServiceChange } {
  const error = appProfilePortError(
    port,
    context.registry.profiles.filter((p) => p.id !== context.entry.id).map((p) => p.port)
  )
  if (error) {
    throw new RuntimeClientError('invalid_argument', error)
  }
  // Start at login keeps the profile's port. A loaded job restarts on it; others read it at load.
  // A failed bootout stops here. The unit comes before the registry, so a failed unit write
  // leaves both on the old port.
  const unit = serveServiceUnitOf(context.entry.userDataPath, false, context.home)
  if (loaded) {
    context.run('/bin/launchctl', ['bootout', `gui/${context.uid}/${unit.label}`])
  }
  try {
    const updated = rewriteServeUnitPort(unit.unitPath, port)
    updateEntry(context, (registry) => ({
      ...registry,
      profiles: registry.profiles.map((profile) =>
        profile.id === context.entry.id ? { ...profile, port } : profile
      )
    }))
    const serveService: ServeServiceChange = loaded ? 'restarted' : updated ? 'updated' : 'none'
    return {
      ...context.entry,
      port,
      serveServiceInstalled: existsSync(unit.unitPath),
      serveService
    }
  } finally {
    if (loaded) {
      context.run('/bin/launchctl', ['bootstrap', `gui/${context.uid}`, unit.unitPath])
    }
  }
}
