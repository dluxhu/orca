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
import { isTrustedUIRenderer } from '../ipc/ui'
import { mainProcessState as state } from '../startup/main-process-state'
import { getAppProfile, isProfileManagerApp, ownDefaultAppPath } from './app-profile'
import { profilesEnv, profilesRoot, runCli } from './profile-manager-cli'
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
    case 'start-at-login': {
      // The existing serve service of the profile: a LaunchAgent with RunAtLoad.
      const service = ['--profile', change.id, 'serve', 'service']
      if (!change.enabled) {
        return [...service, 'uninstall', '--json']
      }
      if (!extra.service) {
        throw new Error('Start at login needs the port and the orca command.')
      }
      return [
        ...service,
        'install',
        '--port',
        String(extra.service.port),
        '--command',
        extra.service.command,
        '--json'
      ]
    }
  }
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
    if (change.kind === 'start-at-login') {
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
    }
    return await runCli(profileCommandArgs(change, { settingsFile, pinRoot, service }))
  } finally {
    if (settingsDir) {
      await rm(settingsDir, { recursive: true, force: true })
    }
    void refreshProfilesMenu()
  }
}

/** Runs `action` on the app of the row `id`. The window sends only the id, never a path. */
async function onAppOf(id: string, action: (appPath: string) => void): Promise<AppProfileReply> {
  const row = (await readAppProfilesState()).rows.find((candidate) => candidate.id === id)
  if (!row) {
    return { ok: false, error: { message: `No profile "${id}".` } }
  }
  action(row.appPath)
  return { ok: true, result: { appPath: row.appPath } }
}

export const openAppProfile = (id: string): Promise<AppProfileReply> => onAppOf(id, openApp)

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

/** "Start at login" of this app's own profile, as Settings shows it. */
export async function readOwnStartAtLogin(): Promise<{ id: string; enabled: boolean }> {
  const { rows, currentId } = await readAppProfilesState()
  // The Profile Manager app has no Settings, so a null id does not come here.
  const id = currentId ?? 'default'
  return { id, enabled: rows.find((row) => row.id === id)?.startAtLogin === true }
}

export function registerProfileManagerIpc(): void {
  ipcMain.handle(
    'appProfiles:state',
    fromProfileManager(() => readAppProfilesState())
  )
  ipcMain.handle('appProfiles:change', fromProfileManager(changeAppProfile))
  ipcMain.handle('appProfiles:open', fromProfileManager(openAppProfile))
  ipcMain.handle(
    'appProfiles:showInFinder',
    fromProfileManager((id: string) => onAppOf(id, (appPath) => shell.showItemInFolder(appPath)))
  )
  // Settings in the main window changes only this app's own profile.
  const fromSettings =
    <T extends unknown[], R>(handler: (...args: T) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: T): Promise<R> =>
      isTrustedUIRenderer(event.sender) || isProfileManagerRenderer(event.sender)
        ? handler(...args)
        : Promise.reject(new Error('Only an Orca window can do this.'))
  ipcMain.handle('appProfiles:ownStartAtLogin', fromSettings(readOwnStartAtLogin))
  ipcMain.handle(
    'appProfiles:setOwnStartAtLogin',
    fromSettings(async (enabled: unknown) =>
      changeAppProfile({
        kind: 'start-at-login',
        id: (await readOwnStartAtLogin()).id,
        enabled: enabled === true
      })
    )
  )
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

export function profilesMenuItems(): MenuItemConstructorOptions[] {
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
      label: translateMain('menu.profileManager', 'Profile Manager…'),
      // No default Orca shortcut uses Shift+Cmd+P.
      accelerator: 'CommandOrControl+Shift+P',
      click: () => void showProfileManager()
    }
  ]
}
