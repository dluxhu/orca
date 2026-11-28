// The Dock icon and the menu-bar template of a profile app. See docs/fork/profiles-design.md, section 8.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import {
  APP_PROFILE_ICON_FILE,
  APP_PROFILE_MENU_BAR_FILE
} from '../../shared/app-profiles/app-profile-icon-files'

let own: NativeImage | null | undefined

/** The profile icon that the userData of this profile app keeps. */
export function ownIconPath(): string {
  return join(app.getPath('userData'), APP_PROFILE_ICON_FILE)
}

/**
 * The image of the profile icon that the userData keeps. That copy is the source of truth; macOS
 * can show an older bundle icon from its cache. A profile app keeps one; the default app keeps one
 * only for an icon with a badge or an uploaded icon (`set-icon default`). Null without a kept icon.
 */
export function ownDockIcon(): NativeImage | null {
  if (own === undefined) {
    own = null
    try {
      const png = largestIcnsPng(readFileSync(ownIconPath()))
      const image = png ? nativeImage.createFromBuffer(png) : null
      own = image && !image.isEmpty() ? image : null
    } catch (error) {
      // No kept icon is the usual case of the default app.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[profiles] cannot read the profile icon:', error)
      }
    }
  }
  return own
}

/** The next ownDockIcon reads the kept copy again. */
export function forgetOwnDockIcon(): void {
  own = undefined
}

/**
 * The menu-bar template that the userData keeps, as a template image; the "@2x" name gives it scale
 * factor 2. Only a profile's userData keeps one. Null without a readable file.
 */
export function ownMenuBarImage(): NativeImage | null {
  const image = nativeImage.createFromPath(join(app.getPath('userData'), APP_PROFILE_MENU_BAR_FILE))
  if (image.isEmpty()) {
    return null
  }
  image.setTemplateImage(true)
  return image
}
