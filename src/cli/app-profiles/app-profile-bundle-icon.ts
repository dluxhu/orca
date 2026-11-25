// The icon of a profile bundle: docs/fork/profiles-design.md, section 8.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAC_DOCK_ICON_SCRIPT } from '../../shared/app-lifecycle/identity/mac-custom-icon-script'
import type { RunTool } from './app-profile-create'
import { appIconFileName } from './app-profile-icon'

/** Writes the icon into a bundle before its signature, in place of the link to the default icon. */
export function writeBundleIcon(contents: string, plistXml: string, icns: Buffer): void {
  const iconPath = join(contents, 'Resources', appIconFileName(plistXml))
  rmSync(iconPath, { force: true })
  writeFileSync(iconPath, icns)
}

/**
 * Sets a Finder custom icon on a signed bundle, as Get Info does: it writes the bundle's Icon file
 * and Finder information, not the signed contents.
 */
export function setFinderIcon(appPath: string, icns: Buffer, run: RunTool): void {
  const temporary = mkdtempSync(join(tmpdir(), 'orca-profile-icon-'))
  try {
    const iconPath = join(temporary, 'icon.icns')
    writeFileSync(iconPath, icns)
    run('/usr/bin/env', [
      `ORCA_APP_BUNDLE_PATH=${appPath}`,
      `ORCA_APP_ICON_PATH=${iconPath}`,
      '/usr/bin/osascript',
      ...MAC_DOCK_ICON_SCRIPT.flatMap((line) => ['-e', line])
    ])
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
