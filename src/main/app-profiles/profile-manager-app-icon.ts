// The Dock icon of each app in the Profile Manager list and in the Profiles menu: the largest PNG
// of the icon that the profile keeps in its userData, else of the app bundle's own .icns.
// See docs/fork/profiles-design.md, section 8.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import { appIconFileName } from '../../cli/app-profiles/app-profile-icon'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import { APP_PROFILE_ICON_FILE } from '../../shared/app-profiles/app-profile-icon-files'
import type { AppProfileRow, AppProfilesState } from '../../shared/app-profiles/app-profile-rules'

/** `list`: a 96 px PNG data URL for a 48 px row icon. `menu`: an 18 pt menu image at 2x. */
export type AppIcon = { list: string; menu: NativeImage }

// The list asks every 3 s, so a file is read again only when its mtime changes.
const icons = new Map<string, { time: number; icon: AppIcon | null }>()
const bundleIcns = new Map<string, { plistTime: number; icnsPath: string }>()

/** The path of the .icns that a bundle's Info.plist names. */
async function bundleIcnsPath(appPath: string): Promise<string> {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  const plistTime = (await stat(plistPath)).mtimeMs
  const cached = bundleIcns.get(appPath)
  if (cached?.plistTime === plistTime) {
    return cached.icnsPath
  }
  const name = appIconFileName(await readFile(plistPath, 'utf8'))
  const icnsPath = join(appPath, 'Contents', 'Resources', name)
  bundleIcns.set(appPath, { plistTime, icnsPath })
  return icnsPath
}

function iconOf(png: Buffer | null): AppIcon | null {
  const image = png ? nativeImage.createFromBuffer(png) : null
  return image && !image.isEmpty()
    ? {
        list: image.resize({ width: 96, height: 96, quality: 'best' }).toDataURL(),
        menu: nativeImage.createFromBuffer(
          image.resize({ width: 36, height: 36, quality: 'best' }).toPNG(),
          { scaleFactor: 2 }
        )
      }
    : null
}

/** The icon of an app, or null when it has no readable PNG icon. */
export async function appIcon(
  row: Pick<AppProfileRow, 'id' | 'appPath' | 'userDataPath'>
): Promise<AppIcon | null> {
  try {
    // set-icon writes the kept copy and does not change the signed bundle.
    const kept = row.id === 'default' ? null : join(row.userDataPath, APP_PROFILE_ICON_FILE)
    const keptTime =
      kept === null
        ? null
        : await stat(kept).then(
            (s) => s.mtimeMs,
            () => null
          )
    const icnsPath = kept !== null && keptTime !== null ? kept : await bundleIcnsPath(row.appPath)
    const time = keptTime ?? (await stat(icnsPath)).mtimeMs
    const cached = icons.get(icnsPath)
    if (cached?.time === time) {
      return cached.icon
    }
    // shortcut: an .icns with no PNG entry (old ARGB only) gives no icon; decode it if one appears.
    const icon = iconOf(largestIcnsPng(await readFile(icnsPath)))
    icons.set(icnsPath, { time, icon })
    return icon
  } catch {
    // A moved or half-written bundle has no icon until the next read.
    return null
  }
}

/** The icons of the rows, by id. */
export async function appIcons(rows: readonly AppProfileRow[]): Promise<Map<string, AppIcon>> {
  const icons = await Promise.all(rows.map((row) => appIcon(row)))
  return new Map(
    rows.flatMap((row, index) => {
      const icon = icons[index]
      return icon ? [[row.id, icon] as const] : []
    })
  )
}

/** The state for the Profile Manager window, with the row icons. */
export async function withAppIcons(state: AppProfilesState): Promise<AppProfilesState> {
  const icons = await appIcons(state.rows)
  return { ...state, icons: Object.fromEntries([...icons].map(([id, icon]) => [id, icon.list])) }
}
