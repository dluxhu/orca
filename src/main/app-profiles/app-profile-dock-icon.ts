// The Dock icon of a profile app. See docs/fork/profiles-design.md, section 8.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import { APP_PROFILE_ICON_FILE } from '../../shared/app-profiles/app-profile-icon-files'
import { getAppProfile } from './app-profile'

let own: NativeImage | null | undefined

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
        const png = largestIcnsPng(
          readFileSync(join(app.getPath('userData'), APP_PROFILE_ICON_FILE))
        )
        const image = png ? nativeImage.createFromBuffer(png) : null
        own = image && !image.isEmpty() ? image : null
      } catch (error) {
        console.warn('[profiles] cannot read the profile icon:', error)
      }
    }
  }
  return own
}
