// The icon parts of the Profile Manager: the preview and the file choice.
// See docs/fork/profiles-design.md, section 8.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import type {
  AppProfileIconSource,
  AppProfileReply,
  ChosenIconFile
} from '../../shared/app-profiles/app-profile-rules'
import {
  CUSTOM_APP_ICON_FILE_EXTENSIONS,
  CustomAppIconImportError,
  decodeCustomAppIcon
} from '../window/desktop-integration/custom-app-icon'
import { fitAppIconToPlatformShape } from '../window/desktop-integration/platform-app-icon-shape'
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

/**
 * An uploaded base icon goes through upstream's custom icon import: its checks (PNG or JPEG,
 * square, size), then the macOS tile shape. The CLI puts the badge on the PNG that this writes.
 */
export async function importIconBase(sourcePath: string): Promise<ChosenIconFile> {
  let image: Electron.NativeImage
  try {
    image = await decodeCustomAppIcon(sourcePath)
  } catch (error) {
    if (error instanceof CustomAppIconImportError) {
      return { code: error.code }
    }
    throw error
  }
  // shortcut: one small temp folder per upload stays until the OS cleans the temp folder.
  const folder = await mkdtemp(join(app.getPath('temp'), 'orca-icon-base-'))
  // The chooser shows the file name of the upload.
  const path = join(folder, `${basename(sourcePath, extname(sourcePath))}.png`)
  await writeFile(path, fitAppIconToPlatformShape(image).toPNG())
  return path
}

/**
 * The path of a badge image or of an uploaded base icon that the user chooses, or null. An uploaded
 * base comes from importIconBase.
 */
export async function chooseAppProfileIconFile(
  kind: 'image' | 'file',
  sender: WebContents
): Promise<ChosenIconFile> {
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
            extensions: CUSTOM_APP_ICON_FILE_EXTENSIONS
          }
    ]
  }
  // A sheet on the Profile Manager window, so it does not hide behind it.
  const parent = BrowserWindow.fromWebContents(sender)
  const result = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options))
  const path = result.canceled ? null : (result.filePaths[0] ?? null)
  return path && kind === 'file' ? importIconBase(path) : path
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
