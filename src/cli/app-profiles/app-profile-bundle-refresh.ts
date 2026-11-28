// The refresh of a profile app after an Orca update: docs/fork/profiles-design.md, section 7.
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  APP_PROFILE_PLIST_ID_KEY,
  APP_PROFILE_PLIST_ROOT_KEY,
  readPlistString
} from '../../shared/app-profiles/app-profile-paths'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  APP_PROFILE_TEMPLATE_KEY,
  buildProfileBundle,
  exists,
  PROFILE_LOADER_DIR,
  templateKeyOf
} from './app-profile-bundle'
import type { RunTool } from './app-profile-create'
import { setFinderIcon, writeBundleIcon } from './app-profile-bundle-icon'
import { APP_PROFILE_ICON_FILE } from '../../shared/app-profiles/app-profile-icon-files'

const PRE_REFRESH = '.pre-refresh'

const versionOf = (plist: string): string | null => {
  const short = readPlistString(plist, 'CFBundleShortVersionString')
  const build = readPlistString(plist, 'CFBundleVersion')
  return short === null && build === null ? null : `${short ?? ''} (${build ?? ''})`
}

function readIcon(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The profile id in a bundle's Info.plist, or null. */
function profileIdOf(bundle: string): string | null {
  const plist = readText(join(bundle, 'Contents', 'Info.plist'))
  return plist === null ? null : readPlistString(plist, APP_PROFILE_PLIST_ID_KEY)
}

/** The previous bundle that a refresh keeps until the new one has started. */
export function preRefreshPathOf(appPath: string): string {
  return `${appPath}${PRE_REFRESH}`
}

/**
 * The previous bundles of the profile `id` that refreshes left in `appsDir`, newest first. The
 * profile id in their Info.plist finds them: a Finder rename changes the app's file name.
 */
export function preRefreshLeftoversOf(appsDir: string, id: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(appsDir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.endsWith(`.app${PRE_REFRESH}`))
    .map((entry) => join(appsDir, entry))
    .filter((path) => profileIdOf(path) === id)
    .sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs)
}

/** Removes the previous bundles of the profile: rename and remove call it. A link goes, not its target. */
export function removePreRefreshLeftovers(appsDir: string, id: string): void {
  for (const path of preRefreshLeftoversOf(appsDir, id)) {
    rmSync(path, { recursive: true, force: true })
  }
}

/**
 * When `appsDir` holds no live bundle of the profile `id` (a refresh stopped between its two
 * renames), its newest previous bundle goes back in place. With a live bundle, `removeOld`
 * removes the previous bundles: the profile app does it after its start.
 */
export function settlePreRefresh(appsDir: string, id: string, removeOld = true): void {
  const leftovers = preRefreshLeftoversOf(appsDir, id)
  if (leftovers.length === 0) {
    return
  }
  const entries = readdirSync(appsDir)
  // A refresh of the profile runs now: between its two renames no live bundle exists.
  if (!removeOld && entries.some((entry) => entry.startsWith(`.${id}.refresh-`))) {
    return
  }
  const live = entries.some(
    (entry) => entry.endsWith('.app') && profileIdOf(join(appsDir, entry)) === id
  )
  if (!live) {
    const restored = leftovers[0].slice(0, -PRE_REFRESH.length)
    // A link is no bundle to bring back.
    if (!exists(restored) && !lstatSync(leftovers[0]).isSymbolicLink()) {
      renameSync(leftovers[0], restored)
      leftovers.shift()
    }
  }
  if (removeOld) {
    for (const path of leftovers) {
      rmSync(path, { recursive: true, force: true })
    }
  }
}

/** The check of the last start: the default app version and the template key of the copies. */
const checkTextOf = (version: string, key: string | null): string => `${version}\n${key ?? ''}\n`

export type RefreshOptions = {
  /** Keeps the default app version and the key of the last check (see refreshAppProfileBundle). */
  checkFile?: string
  /** The profile's userData. */
  userDataPath?: string
}

/**
 * Builds the profile app again from the default app when the template key (templateKeyOf) differs
 * from the one that its own Info.plist records, or when CFBundleName is not the app's file name.
 * The new bundle is a fresh build next to the app (buildProfileBundle, as create makes one), not a
 * copy of the old bundle, so no Finder data of the old bundle can block the signature. Then it is
 * swapped in; the previous bundle stays as <app>.pre-refresh until the next start
 * (settlePreRefresh). The profile's data stays. `checkFile`: a start with the same default app
 * version and key, and complete copies, reads no executables. Returns true when the bundle changed.
 */
export function refreshAppProfileBundle(
  appPath: string,
  defaultApp: string,
  run: RunTool,
  options: RefreshOptions = {}
): boolean {
  const ownPlist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  const id = readPlistString(ownPlist, APP_PROFILE_PLIST_ID_KEY)
  if (!id) {
    throw new RuntimeClientError('invalid_argument', `${appPath} is not a profile app.`)
  }
  settlePreRefresh(dirname(appPath), id)
  const source = join(defaultApp, 'Contents')
  const target = versionOf(readFileSync(join(source, 'Info.plist'), 'utf8'))
  if (target === null) {
    return false
  }
  const ownKey = readPlistString(ownPlist, APP_PROFILE_TEMPLATE_KEY)
  const executable = readPlistString(ownPlist, 'CFBundleExecutable') ?? ''
  const menuName = readPlistString(ownPlist, 'CFBundleName') ?? ''
  // The copies that a start needs: a bundle without them is checked again. A bundle with no loader
  // has the app.asar link of older releases, which Electron 45 cannot read.
  const complete =
    exists(join(appPath, 'Contents', 'MacOS', executable)) &&
    exists(join(appPath, 'Contents', 'Frameworks', `${menuName} Helper (Renderer).app`)) &&
    exists(join(appPath, 'Contents', 'Resources', PROFILE_LOADER_DIR, 'boot.js'))
  const { checkFile } = options
  if (checkFile && complete && readText(checkFile) === checkTextOf(target, ownKey)) {
    return false
  }
  const templateKey = templateKeyOf(defaultApp, run)
  // A rename changes only the file name (no new signature); the menu-bar name follows here.
  const changed = !complete || templateKey !== ownKey || menuName !== basename(appPath, '.app')
  if (changed) {
    rebuild(appPath, defaultApp, id, ownPlist, run, options.userDataPath)
  }
  if (checkFile) {
    try {
      writeFileSync(checkFile, checkTextOf(target, templateKey))
    } catch {
      // The next start checks again.
    }
  }
  return changed
}

function rebuild(
  appPath: string,
  defaultApp: string,
  id: string,
  ownPlist: string,
  run: RunTool,
  userDataPath?: string
): void {
  // The file name is the profile name: a rename moves only the bundle.
  const name = basename(appPath, '.app')
  const root = readPlistString(ownPlist, APP_PROFILE_PLIST_ROOT_KEY) ?? undefined
  const staging = mkdtempSync(join(dirname(appPath), `.${id}.refresh-`))
  try {
    const next = join(staging, basename(appPath))
    // The kept icon of the profile: its file goes in before the seal, the Finder icon after it.
    const icon = userDataPath ? readIcon(join(userDataPath, APP_PROFILE_ICON_FILE)) : null
    buildProfileBundle(
      defaultApp,
      next,
      { id, name, root },
      run,
      staging,
      icon ? (contents, plist) => writeBundleIcon(contents, plist, icon) : undefined
    )
    if (icon) {
      // Best effort: the Dock reads the icon file in the seal; the Finder icon is the stopped app's.
      try {
        setFinderIcon(next, icon, run)
      } catch (error) {
        console.warn('[profiles] cannot set the Finder icon of the refreshed app:', error)
      }
    }
    // The live bundle moves to a visible sibling first: staging never holds the only copy.
    const previous = preRefreshPathOf(appPath)
    renameSync(appPath, previous)
    try {
      renameSync(next, appPath)
    } catch (error) {
      renameSync(previous, appPath)
      throw error
    }
  } catch (error) {
    throw new RuntimeClientError(
      'profile_refresh_failed',
      `Orca could not update the profile app ${appPath}: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
