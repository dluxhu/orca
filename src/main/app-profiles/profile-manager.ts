// The Profile Manager in the main process: the list, the changes and the Profiles menu.
// See docs/fork/profiles-design.md, section 4. Changes run `orca profiles`, so the CLI and this
// window share one writer of profiles.json.
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app, ipcMain, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import {
  APP_PROFILES_ROOT_ENV,
  appProfilesRoot,
  readAppProfileMarker
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
import { getAppProfile } from './app-profile'
import { isProfileManagerRenderer, openProfileManagerWindow } from './profile-manager-window'

/** The root of this app's profiles. A profile app with a test root keeps it. */
function profilesRoot(): string {
  const profile = getAppProfile()
  return profile ? dirname(profile.userDataPath) : appProfilesRoot()
}

function profilesEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [APP_PROFILES_ROOT_ENV]: profilesRoot() }
}

export async function readAppProfilesState(
  options: { serviceRun?: ServeServiceRun } = {}
): Promise<AppProfilesState> {
  const profile = getAppProfile()
  const rows = await listAppProfiles({
    env: profilesEnv(),
    serviceRun: options.serviceRun,
    // Without profiles.json there are no profiles, and this app is the default app.
    defaultAppPath: resolve(process.execPath, '..', '..', '..'),
    // The default app's userData, as the CLI's getPlatformUserDataPath gives it on macOS.
    defaultUserDataPath: profile ? join(app.getPath('appData'), 'orca') : app.getPath('userData')
  })
  const taken = new Set(rows.map((row) => row.id.toLowerCase()))
  let keptIds: string[] = []
  try {
    // Ids ignore case, as appProfileIdError does.
    keptIds = readdirSync(profilesRoot()).flatMap((name) => {
      const marker = readAppProfileMarker(join(profilesRoot(), name))
      return marker && marker.toLowerCase() === name.toLowerCase() && !taken.has(name.toLowerCase())
        ? [marker]
        : []
    })
  } catch {
    // No root yet: no kept data.
  }
  return { rows, currentId: profile?.id ?? 'default', keptIds }
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

/** Runs the CLI of this app as Node. The reply is the CLI's `--json` output. */
function runCli(args: string[]): Promise<AppProfileReply> {
  const cli = join(process.resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
  return new Promise((done) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...profilesEnv(), ELECTRON_RUN_AS_NODE: '1' } },
      (error, stdout) => {
        try {
          done(JSON.parse(stdout) as AppProfileReply)
        } catch {
          done({ ok: false, error: { message: error?.message ?? 'orca failed.' } })
        }
      }
    )
  })
}

export async function changeAppProfile(change: AppProfileChange): Promise<AppProfileReply> {
  if (!app.isPackaged) {
    return { ok: false, error: { message: 'Profiles need a packaged Orca app.' } }
  }
  let settingsDir: string | null = null
  try {
    let settingsFile: string | undefined
    if (change.kind === 'create' && change.copySettings && state.store) {
      settingsDir = mkdtempSync(join(tmpdir(), 'orca-profile-settings-'))
      settingsFile = join(settingsDir, 'settings.json')
      writeFileSync(settingsFile, JSON.stringify(state.store.getSettings()), { mode: 0o600 })
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
      rmSync(settingsDir, { recursive: true, force: true })
    }
    void refreshProfilesMenu()
  }
}

/** Brings the app to the front, or starts it. */
function openApp(appPath: string): void {
  execFile('/usr/bin/open', ['-a', appPath], (error) => {
    if (error) {
      console.warn('[profiles] open failed:', error.message)
    }
  })
}

export async function openAppProfile(id: string): Promise<AppProfileReply> {
  const row = (await readAppProfilesState()).rows.find((candidate) => candidate.id === id)
  if (!row) {
    return { ok: false, error: { message: `No profile "${id}".` } }
  }
  openApp(row.appPath)
  return { ok: true, result: { opened: row.appPath } }
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

/** "Start at login" of this app's own profile, as Settings shows it. */
export async function readOwnStartAtLogin(): Promise<{ id: string; enabled: boolean }> {
  const { rows, currentId } = await readAppProfilesState()
  return { id: currentId, enabled: rows.find((row) => row.id === currentId)?.startAtLogin === true }
}

export function registerProfileManagerIpc(): void {
  ipcMain.handle(
    'appProfiles:state',
    fromProfileManager(() => readAppProfilesState())
  )
  ipcMain.handle('appProfiles:change', fromProfileManager(changeAppProfile))
  ipcMain.handle('appProfiles:open', fromProfileManager(openAppProfile))
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
  const currentId = getAppProfile()?.id ?? 'default'
  const stateLabel = {
    running: translateMain('menu.profileRunning', 'Running'),
    background: translateMain('menu.profileBackground', 'Running in background'),
    stopped: ''
  }
  return [
    ...menuRows.map((row): MenuItemConstructorOptions => {
      const name = row.id === 'default' ? translateMain('menu.profileDefault', 'Default') : row.name
      return {
        label: row.state === 'stopped' ? name : `${name} — ${stateLabel[row.state]}`,
        type: 'checkbox',
        checked: row.id === currentId,
        click: () => openApp(row.appPath)
      }
    }),
    ...(menuRows.length > 0 ? [{ type: 'separator' } as const] : []),
    {
      label: translateMain('menu.profileManager', 'Profile Manager…'),
      click: () => openProfileManagerWindow()
    }
  ]
}
