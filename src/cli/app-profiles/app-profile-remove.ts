// Removal of a profile: docs/fork/profiles-design.md, section 9, "Remove".
import { existsSync, lstatSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readAppProfileMarker } from '../../shared/app-profiles/app-profile-paths'
import { RuntimeClientError } from '../runtime/connection/types'
import { LSREGISTER, type RunTool } from './app-profile-create'
import {
  prepare,
  rootOf,
  tryRun,
  updateEntry,
  type Context,
  type EditAppProfileOptions,
  type ServeServiceChange
} from './app-profile-edit'
import { serveServiceUnitOf } from './app-profile-list'
import { isInside, withRegistryLockAsync } from './app-profile-registry'
import { removePreRefreshLeftovers } from './app-profile-bundle-refresh'

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
  return withRegistryLockAsync(rootOf(options, 'remove'), async () => {
    // prepare refuses the app and a server that the service did not start. removeLocked stops
    // the profile's own service before it moves the data.
    const context = await prepare(options, 'remove')
    return removeLocked(context, options)
  })
}

/**
 * The app and data folder that remove may move to the Trash. profiles.json is plain data, so
 * remove moves only what is Orca's: the app in the apps folder with this profile's id, and the
 * folder <root>/<id> with this profile's marker. Anything else stops the remove.
 */
function removalTargets(
  context: Context,
  keepData: boolean
): { app: string | null; data: string | null } {
  const { entry } = context
  const refuse = (path: string): never => {
    throw new RuntimeClientError(
      'invalid_argument',
      `profiles.json names ${path} for "${entry.id}", which is not a folder of this profile. Orca does not move it.`
    )
  }
  const app = context.located
  if (
    app &&
    (dirname(resolve(app)) !== context.appsDir ||
      lstatSync(app).isSymbolicLink() ||
      !isInside(app, context.appsDir))
  ) {
    refuse(app)
  }
  const dataPath = join(context.root, entry.id)
  if (keepData || !existsSync(entry.userDataPath)) {
    return { app, data: null }
  }
  if (
    resolve(entry.userDataPath) !== resolve(dataPath) ||
    lstatSync(dataPath).isSymbolicLink() ||
    !isInside(dataPath, context.root) ||
    readAppProfileMarker(dataPath) !== entry.id
  ) {
    refuse(entry.userDataPath)
  }
  return { app, data: dataPath }
}

function removeLocked(
  context: Context,
  options: { keepData: boolean; trash?: (path: string) => void }
): { id: string; keptData: boolean; serveService: ServeServiceChange } {
  const { entry, run } = context
  const trash = options.trash ?? ((path: string) => moveToTrash(run, path, context.home))
  const targets = removalTargets(context, options.keepData)
  const unit = serveServiceUnitOf(entry.userDataPath, false, context.home)
  let serveService: ServeServiceChange = 'none'
  if (context.inBackground || existsSync(unit.unitPath)) {
    tryRun(run, '/bin/launchctl', ['bootout', `gui/${context.uid}/${unit.label}`])
    rmSync(unit.unitPath, { force: true })
    serveService = 'removed'
  }
  // Kept data must not start an old job again.
  rmSync(unit.copyPath, { force: true })
  if (targets.app) {
    tryRun(run, LSREGISTER, ['-u', targets.app])
    trash(targets.app)
  }
  // The previous bundles of refreshes go too: they would bring the app back.
  removePreRefreshLeftovers(dirname(targets.app ?? entry.appPath), entry.id)
  if (targets.data) {
    trash(targets.data)
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
}
