// The Profile Manager window's calls, and the Start at login setting of this app's own profile.
import { ipcRenderer } from 'electron'
import type {
  AppProfileChange,
  AppProfileIconSource,
  AppProfileReply,
  AppProfilesState
} from '../../../shared/app-profiles/app-profile-rules'

export const appProfilesApi = {
  getState: (): Promise<AppProfilesState> => ipcRenderer.invoke('appProfiles:state'),
  change: (change: AppProfileChange): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:change', change),
  open: (id: string): Promise<AppProfileReply> => ipcRenderer.invoke('appProfiles:open', id),
  /** The reply's result is `{ png: <base64 PNG>, icon }`. */
  iconPreview: (icon: AppProfileIconSource, id?: string | null): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:iconPreview', icon, id),
  /** The reply's result is `{ base, badge }`: base64 PNGs at 1024 px. */
  iconParts: (icon: AppProfileIconSource, id?: string | null): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:iconParts', icon, id),
  chooseIconFile: (kind: 'image' | 'file'): Promise<string | null> =>
    ipcRenderer.invoke('appProfiles:chooseIconFile', kind),
  showInFinder: (id: string): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:showInFinder', id),
  /** Profiles > New profile… while the window is open. */
  onStartNew: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('appProfiles:startNew', listener)
    return () => ipcRenderer.removeListener('appProfiles:startNew', listener)
  },
  /** "Start at login" of this app's own profile (Settings). */
  getOwnStartAtLogin: (): Promise<{ id: string; enabled: boolean }> =>
    ipcRenderer.invoke('appProfiles:ownStartAtLogin'),
  setOwnStartAtLogin: (enabled: boolean): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:setOwnStartAtLogin', enabled)
}

export type AppProfilesApi = typeof appProfilesApi
