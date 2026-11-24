// The Dock icon of a profile app. See docs/fork/profiles-design.md, section 8.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { appIconFileName } from '../../cli/app-profiles/app-profile-icon'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import { getAppProfile } from './app-profile'

let own: NativeImage | null | undefined

/**
 * In a profile app: the image of its own bundle icon. macOS can keep an old image of the app icon
 * in a cache, so the app sets this image on its Dock tile. Null in every other app.
 */
export function ownDockIcon(): NativeImage | null {
  if (own === undefined) {
    own = null
    if (getAppProfile()) {
      try {
        const contents = dirname(dirname(app.getPath('exe')))
        const plist = readFileSync(join(contents, 'Info.plist'), 'utf8')
        const png = largestIcnsPng(
          readFileSync(join(contents, 'Resources', appIconFileName(plist)))
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
