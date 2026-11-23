// The icon parts of the Profile Manager: the preview and the file choice.
// See docs/fork/profiles-design.md, section 8.
import { dialog } from 'electron'
import type {
  AppProfileIconSource,
  AppProfileReply
} from '../../shared/app-profiles/app-profile-rules'
import { translateMain } from '../i18n/main-i18n'
import { appProfileIconFlags } from './app-profile-icon'
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
export async function chooseAppProfileIconFile(kind: 'image' | 'file'): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      kind === 'image'
        ? {
            name: translateMain('profileManager.icon.imageFiles', 'Images'),
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'icns']
          }
        : {
            name: translateMain('profileManager.icon.iconFiles', 'Icons'),
            extensions: ['icns', 'png']
          }
    ]
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}
