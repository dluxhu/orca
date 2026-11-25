// The refresh of a profile app after an Orca update: docs/fork/profiles-design.md, section 7.
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
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
  applyProfilePlist,
  copyAppRuntime,
  copyDefaultPlist,
  exists,
  signProfileBundle,
  templateKeyOf
} from './app-profile-bundle'
import type { RunTool } from './app-profile-create'

const versionOf = (plist: string): string | null => {
  const short = readPlistString(plist, 'CFBundleShortVersionString')
  const build = readPlistString(plist, 'CFBundleVersion')
  return short === null && build === null ? null : `${short ?? ''} (${build ?? ''})`
}

/** The previous bundle that a refresh keeps until the new one has started. */
export function preRefreshPathOf(appPath: string): string {
  return `${appPath}.pre-refresh`
}

/**
 * After a refresh: the new app has started, so its previous bundle goes (`removeOld`: false keeps
 * it, for a caller that is not the started app). A refresh that stopped between its two renames
 * left only the previous bundle: it goes back in place.
 */
export function settlePreRefresh(appPath: string, removeOld = true): void {
  const previous = preRefreshPathOf(appPath)
  if (!exists(previous)) {
    return
  }
  if (exists(appPath)) {
    if (removeOld) {
      rmSync(previous, { recursive: true, force: true })
    }
  } else {
    renameSync(previous, appPath)
  }
}

/**
 * Runs `sign` without the Finder information of the bundle (a Finder custom icon sets it), and
 * then puts it back: codesign refuses a bundle with it ("detritus not allowed").
 */
export function signWithoutFinderInfo(bundle: string, run: RunTool, sign: () => void): void {
  const attribute = 'com.apple.FinderInfo'
  const hex = run('/bin/sh', [
    '-c',
    `/usr/bin/xattr -px ${attribute} "$0" 2>/dev/null || true`,
    bundle
  ]).replace(/\s+/g, '')
  if (hex) {
    run('/usr/bin/xattr', ['-d', attribute, bundle])
  }
  try {
    sign()
  } finally {
    if (hex) {
      run('/usr/bin/xattr', ['-wx', attribute, hex, bundle])
    }
  }
}

/** The check of the last start: the default app version and the template key of the copies. */
const checkTextOf = (version: string, key: string | null): string => `${version}\n${key ?? ''}\n`

/**
 * Copies the executables, the helper apps, the Electron framework and the Info.plist of the
 * default app into the profile app again when the template key (templateKeyOf) differs from the
 * one that its own Info.plist records, or when CFBundleName is not the app's file name. The
 * profile's data, Resources links and icon files stay. The new bundle is built next to the app
 * and then swapped in; the previous bundle stays as <app>.pre-refresh until the next start
 * (settlePreRefresh). `checkFile` keeps the default app version and the key of the last check:
 * a start with the same version and complete copies reads no executables. Returns true when the
 * bundle changed.
 */
export function refreshAppProfileBundle(
  appPath: string,
  defaultApp: string,
  run: RunTool,
  checkFile?: string
): boolean {
  settlePreRefresh(appPath)
  const source = join(defaultApp, 'Contents')
  const target = versionOf(readFileSync(join(source, 'Info.plist'), 'utf8'))
  if (target === null) {
    return false
  }
  const ownPlist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  const ownKey = readPlistString(ownPlist, APP_PROFILE_TEMPLATE_KEY)
  const executable = readPlistString(ownPlist, 'CFBundleExecutable') ?? ''
  const menuName = readPlistString(ownPlist, 'CFBundleName') ?? ''
  // The copies that a start needs: a bundle without them is checked again.
  const complete =
    exists(join(appPath, 'Contents', 'MacOS', executable)) &&
    exists(join(appPath, 'Contents', 'Frameworks', `${menuName} Helper (Renderer).app`))
  if (checkFile && complete && readText(checkFile) === checkTextOf(target, ownKey)) {
    return false
  }
  const templateKey = templateKeyOf(defaultApp, run)
  // A rename changes only the file name (no new signature); the menu-bar name follows here.
  const changed = !complete || templateKey !== ownKey || menuName !== basename(appPath, '.app')
  if (changed) {
    rebuild(appPath, defaultApp, ownPlist, templateKey, run)
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
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function rebuild(
  appPath: string,
  defaultApp: string,
  ownPlist: string,
  templateKey: string,
  run: RunTool
): void {
  const source = join(defaultApp, 'Contents')
  const id = readPlistString(ownPlist, APP_PROFILE_PLIST_ID_KEY)
  const bundleId = readPlistString(ownPlist, 'CFBundleIdentifier')
  // The file name is the profile name: a rename moves only the bundle.
  const name = basename(appPath, '.app')
  if (!id || !bundleId || !name) {
    throw new RuntimeClientError('invalid_argument', `${appPath} is not a profile app.`)
  }
  const root = readPlistString(ownPlist, APP_PROFILE_PLIST_ROOT_KEY) ?? undefined
  const staging = mkdtempSync(join(dirname(appPath), `.${id}.refresh-`))
  try {
    const next = join(staging, basename(appPath))
    // A clone keeps the Resources links, the icon files and the Finder custom icon.
    run('/bin/cp', ['-cR', appPath, next])
    const contents = join(next, 'Contents')
    rmSync(join(contents, 'MacOS'), { recursive: true, force: true })
    rmSync(join(contents, 'Frameworks'), { recursive: true, force: true })
    const plistPath = join(contents, 'Info.plist')
    const executable = readPlistString(
      copyDefaultPlist(source, plistPath, run),
      'CFBundleExecutable'
    )
    if (!executable) {
      throw new RuntimeClientError('invalid_argument', `${defaultApp} has no executable.`)
    }
    const helpers = copyAppRuntime(source, contents, executable, name, run)
    // A Resources entry that the new version adds gets its link.
    for (const entry of readdirSync(join(source, 'Resources'))) {
      if (!exists(join(contents, 'Resources', entry))) {
        symlinkSync(join(source, 'Resources', entry), join(contents, 'Resources', entry))
      }
    }
    applyProfilePlist(plistPath, { bundleId, name, id, root, templateKey }, run)
    signWithoutFinderInfo(next, run, () =>
      signProfileBundle(next, defaultApp, bundleId, helpers, staging, run)
    )
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
