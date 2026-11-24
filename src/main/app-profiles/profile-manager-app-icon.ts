// The Dock icon of each app in the Profile Manager list and in the Profiles menu: the largest PNG
// of the app bundle's own .icns. See docs/fork/profiles-design.md, section 8.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import { appIconFileName } from '../../cli/app-profiles/app-profile-icon'
import { largestIcnsPng } from '../../cli/app-profiles/app-profile-icns'
import type { AppProfileRow, AppProfilesState } from '../../shared/app-profiles/app-profile-rules'

/** `list`: a 96 px PNG data URL for a 48 px row icon. `menu`: an 18 pt menu image at 2x. */
export type AppIcon = { list: string; menu: NativeImage }

type Entry = { plistTime: number; icnsPath: string; icnsTime: number; icon: AppIcon | null }

// By bundle path. The list asks every 3 s, so a file is read again only when its mtime changes.
const cache = new Map<string, Entry>()

/** The icon of the app at `appPath`, or null when its bundle has no readable PNG icon. */
export async function appIcon(appPath: string): Promise<AppIcon | null> {
  const contents = join(appPath, 'Contents')
  const plistPath = join(contents, 'Info.plist')
  try {
    const plistTime = (await stat(plistPath)).mtimeMs
    const cached = cache.get(appPath)
    const icnsPath =
      cached?.plistTime === plistTime
        ? cached.icnsPath
        : join(contents, 'Resources', appIconFileName(await readFile(plistPath, 'utf8')))
    const icnsTime = (await stat(icnsPath)).mtimeMs
    if (cached?.plistTime === plistTime && cached.icnsTime === icnsTime) {
      return cached.icon
    }
    // shortcut: an .icns with no PNG entry (old ARGB only) gives no icon; decode it if one appears.
    const png = largestIcnsPng(await readFile(icnsPath))
    const image = png ? nativeImage.createFromBuffer(png) : null
    const icon =
      image && !image.isEmpty()
        ? {
            list: image.resize({ width: 96, height: 96, quality: 'best' }).toDataURL(),
            menu: nativeImage.createFromBuffer(
              image.resize({ width: 36, height: 36, quality: 'best' }).toPNG(),
              { scaleFactor: 2 }
            )
          }
        : null
    cache.set(appPath, { plistTime, icnsPath, icnsTime, icon })
    return icon
  } catch {
    // A moved or half-written bundle has no icon until the next read.
    return null
  }
}

/** The icons of the rows, by id. */
export async function appIcons(rows: readonly AppProfileRow[]): Promise<Map<string, AppIcon>> {
  const icons = await Promise.all(rows.map((row) => appIcon(row.appPath)))
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
