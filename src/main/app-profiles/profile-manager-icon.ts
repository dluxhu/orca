// The icon parts of the Profile Manager: the preview and the file choice.
// See docs/fork/profiles-design.md, section 8.
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type {
  AppProfileIconSource,
  AppProfileReply
} from '../../shared/app-profiles/app-profile-rules'
import { translateMain } from '../i18n/main-i18n'
import { appProfileIconFlags } from '../../shared/app-profiles/app-profile-rules'
import { runCli } from './profile-manager-cli'

/**
 * The preview of an icon: the CLI makes it, so the window does not stop for the seconds it takes.
 * `id`: the profile that the Edit form changes; its own badge character is free.
 */
export function previewAppProfileIcon(
  icon: AppProfileIconSource,
  id?: string | null
): Promise<AppProfileReply> {
  return runCli([
    'profiles',
    'icon-preview',
    ...(id ? ['--id', id] : []),
    ...appProfileIconFlags(icon),
    '--json'
  ])
}

/** The path of a badge image or of an icon file that the user chooses, or null. */
export async function chooseAppProfileIconFile(
  kind: 'image' | 'file',
  sender: WebContents
): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      kind === 'image'
        ? {
            name: translateMain('profileManager.icon.imageFiles', 'Images'),
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'icns']
          }
        : {
            name: translateMain('profileManager.icon.iconFiles', 'Icons'),
            extensions: ['icns', 'png', 'jpg', 'jpeg']
          }
    ]
  }
  // A sheet on the Profile Manager window, so it does not hide behind it.
  const parent = BrowserWindow.fromWebContents(sender)
  const result = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options))
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** The sender check of the Profile Manager IPC calls. */
export type ProfileManagerGuard = <T extends unknown[], R>(
  handler: (...args: T) => Promise<R>
) => (event: IpcMainInvokeEvent, ...args: T) => Promise<R>

export function registerProfileIconIpc(fromProfileManager: ProfileManagerGuard): void {
  ipcMain.handle('appProfiles:iconPreview', fromProfileManager(previewAppProfileIcon))
  ipcMain.handle('appProfiles:chooseIconFile', (event: IpcMainInvokeEvent, kind: unknown) =>
    fromProfileManager(async () =>
      chooseAppProfileIconFile(kind === 'file' ? 'file' : 'image', event.sender)
    )(event)
  )
}
