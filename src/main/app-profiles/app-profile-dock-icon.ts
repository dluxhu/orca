// The Dock icon and the menu-bar template of a profile app. See docs/fork/profiles-design.md, section 8.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import {
  APP_PROFILE_ICON_FILE,
  APP_PROFILE_MENU_BAR_FILE
} from '../../shared/app-profiles/app-profile-icon-files'
import { getAppProfile } from './app-profile'

let own: NativeImage | null | undefined

/** The profile icon that the userData of this profile app keeps. */
export function ownIconPath(): string {
  return join(app.getPath('userData'), APP_PROFILE_ICON_FILE)
}

/**
 * In a profile app: the image of the profile icon that its userData keeps. That copy is the source
 * of truth; macOS can show an older bundle icon from its cache. Null in every other app, and in a
 * profile with no kept icon.
 */
export function ownDockIcon(): NativeImage | null {
  if (own === undefined) {
    own = null
    if (getAppProfile()) {
      try {
        const png = largestIcnsPng(readFileSync(ownIconPath()))
        const image = png ? nativeImage.createFromBuffer(png) : null
        own = image && !image.isEmpty() ? image : null
      } catch (error) {
        console.warn('[profiles] cannot read the profile icon:', error)
      }
    }
  }
  return own
}

/**
 * In a profile app: the menu-bar template that its userData keeps, as a 2x template image. Null in
 * every other app, and in a profile with no kept template.
 */
export function ownMenuBarImage(): NativeImage | null {
  if (!getAppProfile()) {
    return null
  }
  try {
    const png = readFileSync(join(app.getPath('userData'), APP_PROFILE_MENU_BAR_FILE))
    const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
    if (image.isEmpty()) {
      return null
    }
    image.setTemplateImage(true)
    return image
  } catch {
    return null
  }
}
