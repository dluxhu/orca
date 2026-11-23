// Rename, port change and removal of a profile: docs/fork/profiles-design.md, section 9.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  appProfilesRoot,
  readAppProfileRegistry,
  type AppProfileEntry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import {
  appProfileNameError,
  appProfilePortError
} from '../../shared/app-profiles/app-profile-rules'
import type { ServeServiceRun } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { RuntimeClientError } from '../runtime/connection/types'
import { defaultAppOf, LSREGISTER, runTool, type RunTool } from './app-profile-create'
import { readAppProfileState, serveServiceUnitOf } from './app-profile-list'
import { withRegistryLock, writeRegistry } from './app-profile-registry'

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

type Context = {
  root: string
  home: string
  uid: number
  run: RunTool
  entry: AppProfileEntry
  registry: AppProfileRegistry
  /** True when the serve service runs and the app does not. */
  inBackground: boolean
}

/** Finds the profile and refuses while its app (or a serve that is not the service) runs. */
async function prepare(options: EditAppProfileOptions, action: string): Promise<Context> {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const root = appProfilesRoot(env, home)
  const registry = readAppProfileRegistry(root)
  const entry = registry?.profiles.find((profile) => profile.id === options.id)
  if (!registry || !entry) {
    const ids = registry?.profiles.map((profile) => profile.id).join(', ') || 'none'
    throw new RuntimeClientError(
      'invalid_argument',
      `No profile "${options.id}". Profiles: ${ids}.`
    )
  }
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
    home,
    uid: options.uid ?? process.getuid?.() ?? 0,
    run: options.run ?? runTool,
    entry,
    registry,
    inBackground: state === 'background'
  }
}

function tryRun(run: RunTool, program: string, args: string[]): void {
  try {
    run(program, args)
  } catch {
    // Best effort: the item is already gone or was never there.
  }
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Profile changes go to the registry entry with this id, under the lock. */
function updateEntry(
  context: Context,
  change: (registry: AppProfileRegistry) => AppProfileRegistry
): void {
  const current = readAppProfileRegistry(context.root) ?? context.registry
  writeRegistry(context.root, change(current))
}

/**
 * Changes the name only: the app file name, CFBundleDisplayName and the registry name. The id,
 * the bundle id and the data folder stay. The new signature has a new code hash, so macOS asks
 * again for the privacy grants and the Keychain item.
 */
export async function renameAppProfile(
  options: EditAppProfileOptions & { name: string }
): Promise<AppProfileEntry & { serveService: ServeServiceChange }> {
  const context = await prepare(options, 'rename')
  const { entry, run } = context
  const name = options.name.trim()
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
  if (!existsSync(oldPath)) {
    throw new RuntimeClientError('invalid_argument', `The app is missing: ${oldPath}`)
  }

  return withRegistryLock(context.root, () => {
    const unit = serveServiceUnitOf(entry.userDataPath, false, context.home)
    const target = `gui/${context.uid}/${unit.label}`
    if (context.inBackground) {
      run('/bin/launchctl', ['bootout', target])
    }
    const plistPath = (app: string): string => join(app, 'Contents', 'Info.plist')
    const entitlements = `${dirname(oldPath)}/.${entry.id}.entitlements.plist`
    const sign = (app: string): void => {
      // Ad hoc, no --deep, as `orca profiles create` signs.
      run('/usr/bin/codesign', [
        '--force',
        '-s',
        '-',
        '-i',
        entry.bundleId,
        '--entitlements',
        entitlements,
        app
      ])
    }
    let serveService: ServeServiceChange = 'none'
    try {
      writeFileSync(
        entitlements,
        run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', defaultAppOf(oldPath)])
      )
      const originalPlist = readFileSync(plistPath(oldPath))
      renameSync(oldPath, newPath)
      try {
        run('/usr/bin/plutil', [
          '-replace',
          'CFBundleDisplayName',
          '-string',
          name,
          plistPath(newPath)
        ])
        sign(newPath)
        // No --strict: the bundle links to the default app's files, and --strict refuses them.
        run('/usr/bin/codesign', ['--verify', newPath])
        tryRun(run, LSREGISTER, ['-u', oldPath])
        run(LSREGISTER, ['-f', newPath])
        updateEntry(context, (registry) => ({
          ...registry,
          profiles: registry.profiles.map((profile) =>
            profile.id === entry.id ? { ...profile, name, appPath: newPath } : profile
          )
        }))
      } catch (failure) {
        // Put the app back under its old name, with its old Info.plist and a valid signature.
        renameSync(newPath, oldPath)
        writeFileSync(plistPath(oldPath), originalPlist)
        tryRun(run, '/usr/bin/codesign', [
          '--force',
          '-s',
          '-',
          '-i',
          entry.bundleId,
          '--entitlements',
          entitlements,
          oldPath
        ])
        throw failure
      }
      // The unit starts the profile's executable by its path. Only Orca's own unit changes here.
      if (existsSync(unit.unitPath)) {
        const content = readFileSync(unit.unitPath, 'utf8')
        const updated = content.split(xml(`${oldPath}/`)).join(xml(`${newPath}/`))
        if (updated !== content) {
          writeFileSync(unit.unitPath, updated)
          serveService = 'updated'
        }
      }
    } finally {
      rmSync(entitlements, { force: true })
      if (context.inBackground) {
        tryRun(run, '/bin/launchctl', ['bootstrap', `gui/${context.uid}`, unit.unitPath])
      }
    }
    if (context.inBackground) {
      serveService = 'restarted'
    }
    return { ...entry, name, appPath: newPath, serveService }
  })
}

/** Changes the port of the profile's desktop endpoint and server. */
export async function setAppProfilePort(
  options: EditAppProfileOptions & { port: number }
): Promise<AppProfileEntry & { serveServiceInstalled: boolean }> {
  const context = await prepare(options, 'edit')
  if (context.inBackground) {
    throw new RuntimeClientError(
      'profile_running',
      `The server of "${context.entry.name}" runs. Stop it before you change the port.`
    )
  }
  const error = appProfilePortError(
    options.port,
    context.registry.profiles.filter((p) => p.id !== options.id).map((p) => p.port)
  )
  if (error) {
    throw new RuntimeClientError('invalid_argument', error)
  }
  return withRegistryLock(context.root, () => {
    updateEntry(context, (registry) => ({
      ...registry,
      profiles: registry.profiles.map((profile) =>
        profile.id === options.id ? { ...profile, port: options.port } : profile
      )
    }))
    const unit = serveServiceUnitOf(context.entry.userDataPath, false, context.home)
    return {
      ...context.entry,
      port: options.port,
      serveServiceInstalled: existsSync(unit.unitPath)
    }
  })
}

/** Moves a file or folder to the Trash. */
function moveToTrash(run: RunTool, path: string, home: string): void {
  if (!existsSync(path)) {
    return
  }
  if (existsSync('/usr/bin/trash')) {
    run('/usr/bin/trash', [path])
    return
  }
  // shortcut: macOS 14 has no `trash` command; a same-volume rename into ~/.Trash, without Finder's "Put Back".
  renameSync(path, join(home, '.Trash', `${basename(path)} ${Date.now()}`))
}

/**
 * Removes the profile: its serve service, its app and (without keepData) its data folder and
 * Keychain item go away; the registry forgets it. Section 9, "Remove".
 */
export async function removeAppProfile(
  options: EditAppProfileOptions & { keepData: boolean; trash?: (path: string) => void }
): Promise<{ id: string; keptData: boolean; serveService: ServeServiceChange }> {
  const context = await prepare(options, 'remove')
  const { entry, run } = context
  const trash = options.trash ?? ((path: string) => moveToTrash(run, path, context.home))
  return withRegistryLock(context.root, () => {
    const unit = serveServiceUnitOf(entry.userDataPath, false, context.home)
    let serveService: ServeServiceChange = 'none'
    if (context.inBackground || existsSync(unit.unitPath)) {
      tryRun(run, '/bin/launchctl', ['bootout', `gui/${context.uid}/${unit.label}`])
      rmSync(unit.unitPath, { force: true })
      serveService = 'removed'
    }
    tryRun(run, LSREGISTER, ['-u', entry.appPath])
    trash(entry.appPath)
    if (!options.keepData) {
      trash(entry.userDataPath)
    }
    updateEntry(context, (registry) => ({
      ...registry,
      urlHandler:
        registry.urlHandler.mode === 'profile' && registry.urlHandler.profileId === entry.id
          ? { mode: 'ask' }
          : registry.urlHandler,
      profiles: registry.profiles.filter((profile) => profile.id !== entry.id)
    }))
    tryRun(run, '/usr/bin/tccutil', ['reset', 'All', entry.bundleId])
    if (!options.keepData) {
      tryRun(run, '/usr/bin/security', [
        'delete-generic-password',
        '-s',
        `orca-${entry.id} Safe Storage`
      ])
    }
    return { id: entry.id, keptData: options.keepData, serveService }
  })
}
