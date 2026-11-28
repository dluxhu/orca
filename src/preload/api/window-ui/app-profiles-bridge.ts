// The Profile Manager window's calls, and the Settings of this app's own profile.
import { ipcRenderer } from 'electron'
import type {
  AppProfileChange,
  AppProfileIconSource,
  AppProfileReply,
  AppProfilesState,
  OwnAppProfile
} from '../../../shared/app-profiles/app-profile-rules'

export const appProfilesApi = {
  getState: (): Promise<AppProfilesState> => ipcRenderer.invoke('appProfiles:state'),
  change: (change: AppProfileChange): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:change', change),
  open: (id: string): Promise<AppProfileReply> => ipcRenderer.invoke('appProfiles:open', id),
  /** The reply's result is `{ png: <base64 PNG>, icon }`. */
  iconPreview: (icon: AppProfileIconSource, id?: string | null): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:iconPreview', icon, id),
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
  /** This app's own profile: Start at login and the saved port (Settings). */
  getOwnProfile: (): Promise<OwnAppProfile> => ipcRenderer.invoke('appProfiles:ownProfile'),
  setOwnStartAtLogin: (enabled: boolean): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:setOwnStartAtLogin', enabled),
  setOwnPort: (port: number): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:setOwnPort', port),
  /** This app's own icon (Settings > Appearance). `appIcon`: the setting saved with it. */
  ownIconPreview: (icon: AppProfileIconSource): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:ownIconPreview', icon),
  chooseOwnIconFile: (kind: 'image' | 'file'): Promise<string | null> =>
    ipcRenderer.invoke('appProfiles:chooseOwnIconFile', kind),
  setOwnIcon: (icon: AppProfileIconSource, appIcon: string): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:setOwnIcon', icon, appIcon)
}

export type AppProfilesApi = typeof appProfilesApi
