// The Profile Manager window's calls. The main process answers only that window.
import { ipcRenderer } from 'electron'
import type {
  AppProfileChange,
  AppProfileReply,
  AppProfilesState
} from '../../../shared/app-profiles/app-profile-rules'

export const appProfilesApi = {
  getState: (): Promise<AppProfilesState> => ipcRenderer.invoke('appProfiles:state'),
  change: (change: AppProfileChange): Promise<AppProfileReply> =>
    ipcRenderer.invoke('appProfiles:change', change),
  open: (id: string): Promise<AppProfileReply> => ipcRenderer.invoke('appProfiles:open', id)
}

export type AppProfilesApi = typeof appProfilesApi
