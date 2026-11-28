// Settings of this app's own profile: Start at login, the saved port and the icon.
// See docs/fork/profiles-design.md, section 4.
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  appProfileIconFlags,
  DEFAULT_APP_PORT,
  type AppProfileIconSource,
  type AppProfileChange,
  type AppProfileReply,
  type AppProfilesState,
  type OwnAppProfile
} from '../../shared/app-profiles/app-profile-rules'
import { isTrustedUIRenderer } from '../ipc/ui'
import { isProfileManagerRenderer } from './profile-manager-window'
import { refreshMacMenuBarImage } from '../tray/system-tray'
import { applyAppIcon } from '../window/desktop-integration/app-icon'
import {
  getCustomAppIconPath,
  hasCustomAppIcon
} from '../window/desktop-integration/custom-app-icon'
import { forgetOwnDockIcon } from './app-profile-dock-icon'
import {
  chooseAppProfileIconFile,
  importIconBase,
  previewAppProfileIcon
} from './profile-manager-icon'
import { runCli } from './profile-manager-cli'

/** This app's own profile, as Settings shows it. */
export function ownAppProfile({ rows, currentId }: AppProfilesState): OwnAppProfile {
  // The Profile Manager app has no Settings, so a null id does not come here.
  const id = currentId ?? 'default'
  const own = rows.find((row) => row.id === id)
  if (!own) {
    throw new Error(`No profile "${id}".`)
  }
  return {
    id: own.id,
    name: own.name,
    enabled: own.startAtLogin,
    port: own.port,
    // appProfilePortError checks the default app's range itself.
    otherPorts: rows
      .filter((row) => row.id !== own.id && row.id !== 'default')
      .map((row) => row.port),
    defaultPort: rows.find((row) => row.id === 'default')?.port ?? DEFAULT_APP_PORT,
    serverRuns: own.state === 'background',
    userDataPath: own.userDataPath,
    ...(own.icon ? { icon: own.icon } : {})
  }
}

/** Settings in the main window changes only this app's own profile. */
export function registerOwnProfileIpc(
  readState: () => Promise<AppProfilesState>,
  change: (change: AppProfileChange) => Promise<AppProfileReply>
): void {
  const fromSettings =
    <T extends unknown[], R>(handler: (...args: T) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: T): Promise<R> =>
      isTrustedUIRenderer(event.sender) || isProfileManagerRenderer(event.sender)
        ? handler(...args)
        : Promise.reject(new Error('Only an Orca window can do this.'))
  const ownId = async (): Promise<string> => ownAppProfile(await readState()).id
  // An icon that Settings imported before (appIcon `custom`) can be the base of a new one. Upstream
  // keeps it unshaped and shapes it for the Dock; the base gets the same tile shape.
  ipcMain.handle(
    'appProfiles:ownProfile',
    fromSettings(async () => {
      const custom = hasCustomAppIcon() ? await importIconBase(getCustomAppIconPath()) : null
      return {
        ...ownAppProfile(await readState()),
        ...(typeof custom === 'string' ? { customIconPath: custom } : {})
      }
    })
  )
  ipcMain.handle(
    'appProfiles:setOwnStartAtLogin',
    fromSettings(async (enabled: unknown) =>
      change({ kind: 'start-at-login', id: await ownId(), enabled: enabled === true })
    )
  )
  // The icon: the same preview and file choice as the Profile Manager, for this app's own id.
  ipcMain.handle(
    'appProfiles:ownIconPreview',
    fromSettings(async (icon: unknown) =>
      previewAppProfileIcon(icon as AppProfileIconSource, await ownId())
    )
  )
  ipcMain.handle('appProfiles:chooseOwnIconFile', (event: IpcMainInvokeEvent, kind: unknown) =>
    fromSettings(async () =>
      chooseAppProfileIconFile(kind === 'file' ? 'file' : 'image', event.sender)
    )(event)
  )
  // The CLI checks the icon. This app runs, and shows the new icon itself (`appIcon`: the setting
  // that the window saves with it).
  ipcMain.handle(
    'appProfiles:setOwnIcon',
    fromSettings(async (icon: unknown, appIcon: unknown) => {
      const flags = appProfileIconFlags(icon as AppProfileIconSource)
      const reply = await runCli([
        'profiles',
        'set-icon',
        await ownId(),
        ...flags,
        '--while-running',
        '--json'
      ])
      if (reply.ok) {
        forgetOwnDockIcon()
        applyAppIcon(appIcon)
        refreshMacMenuBarImage()
      }
      return reply
    })
  )
  // The CLI checks the port: its range, and the ports of the other profiles.
  ipcMain.handle(
    'appProfiles:setOwnPort',
    fromSettings(async (port: unknown) =>
      change({ kind: 'set-port', id: await ownId(), port: Number(port) })
    )
  )
}
