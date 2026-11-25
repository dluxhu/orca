// The Profile Manager in the main process: the list, the changes and the Profiles menu.
// See docs/fork/profiles-design.md, section 4. Changes run `orca profiles`, so the CLI and this
// window share one writer of profiles.json.
import { mkdirSync, watch } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  app,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import {
  APP_PROFILE_MARKER,
  appProfilesRoot,
  parseAppProfileMarker
} from '../../shared/app-profiles/app-profile-paths'
import type {
  AppProfileChange,
  AppProfileReply,
  AppProfileRow,
  AppProfilesState
} from '../../shared/app-profiles/app-profile-rules'
import { listAppProfiles } from '../../cli/app-profiles/app-profile-list'
import {
  runServeServiceManager,
  type ServeServiceRun
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { translateMain } from '../i18n/main-i18n'
import { mainProcessState as state } from '../startup/main-process-state'
import { getAppProfile, isProfileManagerApp, ownDefaultAppPath } from './app-profile'
import { profilesEnv, profilesRoot, runCli } from './profile-manager-cli'
import { registerOwnProfileIpc } from './profile-manager-settings'
import { isProfileManagerRenderer, openApp, showProfileManager } from './profile-manager-window'

/** The id of this app's row: null in the Profile Manager app, which is no row. */
function currentAppId(): string | null {
  return isProfileManagerApp() ? null : (getAppProfile()?.id ?? 'default')
}

export async function readAppProfilesState(
  options: { serviceRun?: ServeServiceRun } = {}
): Promise<AppProfilesState> {
  const currentId = currentAppId()
  const rows = await listAppProfiles({
    env: profilesEnv(),
    serviceRun: options.serviceRun,
    // Used when there is no profiles.json yet.
    defaultAppPath: await ownDefaultAppPath(),
    // The default app's userData, as the CLI's getPlatformUserDataPath gives it on macOS.
    defaultUserDataPath:
      currentId === 'default' ? app.getPath('userData') : join(app.getPath('appData'), 'orca')
  })
  const taken = new Set(rows.map((row) => row.id.toLowerCase()))
  const root = profilesRoot()
  // No root yet: no kept data.
  const names = await readdir(root).catch(() => [])
  const markers = await Promise.all(
    names.map((name) =>
      readFile(join(root, name, APP_PROFILE_MARKER), 'utf8').then(parseAppProfileMarker, () => null)
    )
  )
  // Ids ignore case, as appProfileIdError does.
  const keptIds = markers.filter(
    (marker, index): marker is string =>
      marker !== null &&
      marker.toLowerCase() === names[index].toLowerCase() &&
      !taken.has(marker.toLowerCase())
  )
  return { rows, currentId, keptIds }
}

/** Where a "Start at login" service runs: the profile's port and the default app's stable `orca`. */
export type StartAtLoginTarget = { port: number; command: string }

/** The `orca` arguments for one change. */
export function profileCommandArgs(
  change: AppProfileChange,
  extra: { settingsFile?: string; pinRoot?: boolean; service?: StartAtLoginTarget } = {}
): string[] {
  switch (change.kind) {
    case 'create':
      return [
        'profiles',
        'create',
        change.name,
        '--id',
        change.id,
        '--port',
        String(change.port),
        ...(extra.settingsFile ? ['--settings-file', extra.settingsFile] : []),
        ...(extra.pinRoot ? ['--pin-root'] : []),
        '--json'
      ]
    case 'rename':
      return ['profiles', 'rename', change.id, '--name', change.name, '--json']
    case 'set-port':
      return ['profiles', 'set-port', change.id, '--port', String(change.port), '--json']
    case 'remove':
      return [
        'profiles',
        'remove',
        change.id,
        ...(change.keepData ? ['--keep-data'] : []),
        '--json'
      ]
    case 'start-at-login':
      // The serve service of the profile is a LaunchAgent with RunAtLoad: its file is the login item.
      return serviceArgs(change.id, change.enabled ? 'install' : 'uninstall', false, extra.service)
    case 'service':
      throw new Error('A service change has more steps: use serviceCommandArgs.')
  }
}

/** One `orca serve service` command. `now`: false changes only the login item (the unit file). */
function serviceArgs(
  id: string,
  action: 'install' | 'uninstall',
  now: boolean,
  service?: StartAtLoginTarget
): string[] {
  const base = ['--profile', id, 'serve', 'service', action]
  const later = now ? [] : [action === 'install' ? '--no-start' : '--keep-running']
  if (action === 'uninstall') {
    return [...base, ...later, '--json']
  }
  if (!service) {
    throw new Error('The serve service needs the port and the orca command.')
  }
  return [...base, '--port', String(service.port), '--command', service.command, ...later, '--json']
}

/**
 * Starts (`run`) or stops the profile's own serve service now, and then puts the login item back
 * as it was: install and uninstall change both.
 */
export function serviceCommandArgs(
  id: string,
  run: boolean,
  startAtLogin: boolean,
  service: StartAtLoginTarget
): string[][] {
  const now = serviceArgs(id, run ? 'install' : 'uninstall', true, service)
  return run === startAtLogin
    ? [now]
    : [now, serviceArgs(id, run ? 'uninstall' : 'install', false, service)]
}

export async function changeAppProfile(change: AppProfileChange): Promise<AppProfileReply> {
  if (!app.isPackaged) {
    return { ok: false, error: { message: 'Profiles need a packaged Orca app.' } }
  }
  let settingsDir: string | null = null
  try {
    let settingsFile: string | undefined
    if (change.kind === 'create' && change.copySettings && state.store) {
      settingsDir = await mkdtemp(join(tmpdir(), 'orca-profile-settings-'))
      settingsFile = join(settingsDir, 'settings.json')
      await writeFile(settingsFile, JSON.stringify(state.store.getSettings()), { mode: 0o600 })
    }
    // A test root must stick in the new bundle, so that a Dock launch finds it.
    const pinRoot = profilesRoot() !== appProfilesRoot({})
    let service: StartAtLoginTarget | undefined
    if (change.kind === 'start-at-login' || change.kind === 'service') {
      const rows = (await readAppProfilesState()).rows
      const row = rows.find((candidate) => candidate.id === change.id)
      if (!row) {
        return { ok: false, error: { message: `No profile "${change.id}".` } }
      }
      // A GUI app's PATH has no orca; the default app's launcher keeps its path across updates.
      const defaultApp = rows.find((candidate) => candidate.id === 'default')?.appPath ?? ''
      service = {
        port: row.port,
        command: join(defaultApp, 'Contents', 'Resources', 'bin', 'orca')
      }
      if (change.kind === 'service') {
        let reply: AppProfileReply = { ok: true, result: {} }
        for (const args of serviceCommandArgs(change.id, change.run, row.startAtLogin, service)) {
          reply = await runCli(args)
          if (!reply.ok) {
            break
          }
        }
        return reply
      }
    }
    return await runCli(profileCommandArgs(change, { settingsFile, pinRoot, service }))
  } finally {
    if (settingsDir) {
      await rm(settingsDir, { recursive: true, force: true })
    }
    void refreshProfilesMenu()
  }
}

/** A handler that runs `action` on the app of a row id. The window sends the id, never a path. */
const onAppOf =
  (action: (appPath: string) => void) =>
  async (id: string): Promise<AppProfileReply> => {
    const row = (await readAppProfilesState()).rows.find((candidate) => candidate.id === id)
    if (!row) {
      return { ok: false, error: { message: `No profile "${id}".` } }
    }
    action(row.appPath)
    return { ok: true, result: { appPath: row.appPath } }
  }

function fromProfileManager<T extends unknown[], R>(
  handler: (...args: T) => Promise<R>
): (event: IpcMainInvokeEvent, ...args: T) => Promise<R> {
  return (event, ...args) => {
    if (!isProfileManagerRenderer(event.sender)) {
      return Promise.reject(new Error('Only the Profile Manager window can do this.'))
    }
    return handler(...args)
  }
}

export function registerProfileManagerIpc(): void {
  ipcMain.handle(
    'appProfiles:state',
    fromProfileManager(() => readAppProfilesState())
  )
  ipcMain.handle('appProfiles:change', fromProfileManager(changeAppProfile))
  ipcMain.handle('appProfiles:open', fromProfileManager(onAppOf(openApp)))
  ipcMain.handle('appProfiles:showInFinder', fromProfileManager(onAppOf(shell.showItemInFolder)))
  registerOwnProfileIpc(readAppProfilesState, changeAppProfile)
}

// The Profiles menu. Electron menus are not live, so the rows are cached and the menu rebuilt.
let menuRows: AppProfileRow[] = []
let rebuildMenu: (() => void) | null = null

// One launchctl print per profile is slow. A refresh on app activation reads only the runtime pids
// again; it reuses the service states for up to a minute.
const SERVICE_STATE_TTL_MS = 60_000
let serviceStates = new Map<string, ReturnType<ServeServiceRun>>()
let serviceStatesAt = 0
const cachedServiceRun: ServeServiceRun = (program, args) => {
  // Only `launchctl print`: lsappinfo reads the live Dock state, which a Dock click changes.
  if (args[0] !== 'print') {
    return runServeServiceManager(program, args)
  }
  const key = [program, ...args].join('\0')
  let result = serviceStates.get(key)
  if (!result) {
    result = runServeServiceManager(program, args)
    serviceStates.set(key, result)
  }
  return result
}

async function refreshProfilesMenu(full = true): Promise<void> {
  if (!rebuildMenu) {
    return
  }
  if (full || Date.now() - serviceStatesAt > SERVICE_STATE_TTL_MS) {
    serviceStates = new Map()
    serviceStatesAt = Date.now()
  }
  try {
    menuRows = (await readAppProfilesState({ serviceRun: cachedServiceRun })).rows
    rebuildMenu()
  } catch (error) {
    console.warn('[profiles] menu refresh failed:', error)
  }
}

/** Keeps the Profiles menu current: at start, on a change of profiles.json, and on activation. */
export function startProfilesMenu(rebuild: () => void): void {
  rebuildMenu = rebuild
  void refreshProfilesMenu()
  const root = profilesRoot()
  try {
    mkdirSync(root, { recursive: true })
    let timer: ReturnType<typeof setTimeout> | null = null
    const watcher = watch(root, () => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => void refreshProfilesMenu(), 300)
    })
    // A removed or unreadable folder stops the watch; the menu still refreshes on activation.
    watcher.on('error', (error) =>
      console.warn('[profiles] the profiles folder watch stopped:', error)
    )
    watcher.unref()
  } catch (error) {
    console.warn('[profiles] cannot watch the profiles folder:', error)
  }
  // Other apps start and stop without a change of profiles.json.
  app.on('did-become-active', () => void refreshProfilesMenu(false))
}

/**
 * The Profiles menu. `managerShortcut`: the shortcut text of the app.profileManager keybinding,
 * shown as a hint. Without it (the Profile Manager app has no keybindings), a native accelerator.
 */
export function profilesMenuItems(managerShortcut?: string): MenuItemConstructorOptions[] {
  const currentId = currentAppId()
  const stateLabel = {
    running: translateMain('menu.profileRunning', 'Running'),
    background: translateMain('menu.profileBackground', 'Running in background'),
    stopped: ''
  }
  const item = (row: AppProfileRow): MenuItemConstructorOptions => {
    const name = row.id === 'default' ? translateMain('menu.profileDefault', 'Default') : row.name
    const click = (): void => openApp(row.appPath)
    return row.id === currentId
      ? { label: name, type: 'checkbox', checked: true, click }
      : { label: row.state === 'stopped' ? name : `${name} — ${stateLabel[row.state]}`, click }
  }
  const section = (label: string, rows: AppProfileRow[]): MenuItemConstructorOptions[] =>
    rows.length > 0 ? [{ type: 'header', label }, ...rows.map(item), { type: 'separator' }] : []
  return [
    ...section(
      translateMain('menu.profileThisApp', 'This app'),
      menuRows.filter((row) => row.id === currentId)
    ),
    ...section(
      translateMain('menu.profileSwitchTo', 'Switch to'),
      menuRows.filter((row) => row.id !== currentId)
    ),
    {
      label: translateMain('menu.profileNew', 'New profile…'),
      click: () => void showProfileManager({ startNew: true })
    },
    {
      label: `${translateMain('menu.profileManager', 'Profile Manager…')}${managerShortcut ? `\t${managerShortcut}` : ''}`,
      ...(managerShortcut === undefined ? { accelerator: 'CommandOrControl+Shift+P' } : {}),
      click: () => void showProfileManager()
    }
  ]
}
