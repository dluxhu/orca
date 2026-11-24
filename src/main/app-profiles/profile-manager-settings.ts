// Settings of this app's own profile: Start at login and the saved port.
// See docs/fork/profiles-design.md, section 4.
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  AppProfileChange,
  AppProfileReply,
  AppProfilesState,
  OwnAppProfile
} from '../../shared/app-profiles/app-profile-rules'
import { isTrustedUIRenderer } from '../ipc/ui'
import { isProfileManagerRenderer } from './profile-manager-window'

/** This app's own profile, as Settings shows it. */
export function ownAppProfile({ rows, currentId }: AppProfilesState): OwnAppProfile {
  const own = rows.find((row) => row.id === currentId)
  if (!own) {
    throw new Error(`No profile "${currentId}".`)
  }
  return {
    id: own.id,
    enabled: own.startAtLogin,
    port: own.port,
    // appProfilePortError checks the default app's range itself.
    otherPorts: rows
      .filter((row) => row.id !== own.id && row.id !== 'default')
      .map((row) => row.port),
    serverRuns: own.state === 'background'
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
  ipcMain.handle(
    'appProfiles:ownProfile',
    fromSettings(async () => ownAppProfile(await readState()))
  )
  ipcMain.handle(
    'appProfiles:setOwnStartAtLogin',
    fromSettings(async (enabled: unknown) =>
      change({ kind: 'start-at-login', id: await ownId(), enabled: enabled === true })
    )
  )
  // The CLI checks the port: its range, and the ports of the other profiles.
  ipcMain.handle(
    'appProfiles:setOwnPort',
    fromSettings(async (port: unknown) =>
      change({ kind: 'set-port', id: await ownId(), port: Number(port) })
    )
  )
}
