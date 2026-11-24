// The icon file inside a profile app bundle. See docs/fork/profiles-design.md, section 8.
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPlistString } from '../../shared/app-profiles/app-profile-paths'
import { appIconFileName } from './app-profile-icon'

/**
 * Writes a new icon into the bundle and signs it. macOS caches an app icon by its bundle and file
 * name, so the icon gets a new name from its content hash, and the Info.plist points to it. Finder
 * and the Dock then read the new icon. When `sign` fails, the old icon and Info.plist come back.
 */
export function swapBundleIcon(appPath: string, icns: Buffer, sign: () => void): void {
  const contents = join(appPath, 'Contents')
  const plistPath = join(contents, 'Info.plist')
  const plist = readFileSync(plistPath, 'utf8')
  const oldName = readPlistString(plist, 'CFBundleIconFile') ?? 'icon.icns'
  const oldPath = join(contents, 'Resources', appIconFileName(plist))
  const name = `icon-${createHash('sha256').update(icns).digest('hex').slice(0, 8)}.icns`
  const newPath = join(contents, 'Resources', name)
  // A profile made before icons has a link to the default app's icon.
  const old = lstatSync(oldPath).isSymbolicLink()
    ? { link: readlinkSync(oldPath) }
    : { bytes: readFileSync(oldPath) }
  rmSync(oldPath, { force: true })
  rmSync(newPath, { force: true })
  writeFileSync(newPath, icns)
  // The document type icons use the same file.
  writeFileSync(
    plistPath,
    plist.replaceAll(`<string>${oldName}</string>`, `<string>${name}</string>`)
  )
  try {
    sign()
  } catch (error) {
    // The old icon and Info.plist match the old seal again.
    rmSync(newPath, { force: true })
    writeFileSync(plistPath, plist)
    if ('link' in old) {
      symlinkSync(old.link, oldPath)
    } else {
      writeFileSync(oldPath, old.bytes)
    }
    throw error
  }
}
