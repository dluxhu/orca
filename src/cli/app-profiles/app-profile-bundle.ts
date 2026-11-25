// The parts of a profile app that are copies of the default app, and their refresh after an update.
// See docs/fork/profiles-design.md, sections 1, 2 and 7.
import {
  existsSync,
  lstatSync,
  mkdirSync,
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
import type { RunTool } from './app-profile-create'

const NOTIFICATION_HELPER = 'orca-notification-status'
const ELECTRON_FRAMEWORK = 'Electron Framework.framework'

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Copies the executables and the Frameworks of the default app into the profile's `contents`.
 * Returns the executables in MacOS other than the main one.
 */
export function copyAppRuntime(
  source: string,
  contents: string,
  executable: string,
  run: RunTool
): string[] {
  const template = join(source, 'Resources', 'profile-template', NOTIFICATION_HELPER)
  if (!existsSync(template)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${dirname(source)} has no profile notification helper. It is too old for profiles.`
    )
  }
  for (const folder of ['MacOS', 'Frameworks']) {
    mkdirSync(join(contents, folder), { recursive: true })
  }
  // No executable is a link: codesign --force could follow it and sign the default app's file.
  const helpers: string[] = []
  for (const entry of readdirSync(join(source, 'MacOS'))) {
    const from = entry === NOTIFICATION_HELPER ? template : join(source, 'MacOS', entry)
    run('/usr/bin/ditto', [from, join(contents, 'MacOS', entry)])
    if (entry !== executable) {
      helpers.push(join(contents, 'MacOS', entry))
    }
  }
  // Electron helper apps are copies, so they find the profile as their main bundle. Helpers
  // crash at start when the Electron framework is a link (slice 1, U4), so it is an APFS clone.
  for (const entry of readdirSync(join(source, 'Frameworks'))) {
    const from = join(source, 'Frameworks', entry)
    const to = join(contents, 'Frameworks', entry)
    if (entry.endsWith('.app')) {
      run('/usr/bin/ditto', [from, to])
    } else if (entry === ELECTRON_FRAMEWORK) {
      run('/bin/cp', ['-cR', from, to])
    } else {
      symlinkSync(from, to)
    }
  }
  return helpers
}

export type ProfilePlistKeys = { bundleId: string; name: string; id: string; root?: string }

/** Copies the default app's Info.plist as XML and returns it. */
export function copyDefaultPlist(source: string, plistPath: string, run: RunTool): string {
  run('/usr/bin/ditto', [join(source, 'Info.plist'), plistPath])
  run('/usr/bin/plutil', ['-convert', 'xml1', plistPath])
  return readFileSync(plistPath, 'utf8')
}

/** Sets the profile's keys in its Info.plist. Only the Profile Manager takes orca: links. */
export function applyProfilePlist(plistPath: string, keys: ProfilePlistKeys, run: RunTool): void {
  const plutil = (...args: string[]): void => {
    run('/usr/bin/plutil', [...args, plistPath])
  }
  plutil('-replace', 'CFBundleIdentifier', '-string', keys.bundleId)
  plutil('-replace', 'CFBundleDisplayName', '-string', keys.name)
  plutil('-replace', APP_PROFILE_PLIST_ID_KEY, '-string', keys.id)
  if (keys.root) {
    plutil('-replace', APP_PROFILE_PLIST_ROOT_KEY, '-string', keys.root)
  }
  // The asar integrity fuse is off.
  for (const key of ['CFBundleURLTypes', 'ElectronAsarIntegrity']) {
    if (readFileSync(plistPath, 'utf8').includes(`<key>${key}</key>`)) {
      plutil('-remove', key)
    }
  }
}

/**
 * Ad hoc, no --deep (the helper apps keep their signatures), no hardened runtime (library
 * validation would refuse the default app's frameworks).
 */
export function signProfileBundle(
  bundle: string,
  defaultApp: string,
  bundleId: string,
  helpers: readonly string[],
  scratch: string,
  run: RunTool
): void {
  const entitlements = join(scratch, 'entitlements.plist')
  writeFileSync(
    entitlements,
    run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', defaultApp])
  )
  for (const helper of helpers) {
    run('/usr/bin/codesign', ['--force', '-s', '-', '-i', bundleId, helper])
  }
  run('/usr/bin/codesign', [
    '--force',
    '-s',
    '-',
    '-i',
    bundleId,
    '--entitlements',
    entitlements,
    bundle
  ])
}

const versionOf = (plist: string): string | null => {
  const short = readPlistString(plist, 'CFBundleShortVersionString')
  const build = readPlistString(plist, 'CFBundleVersion')
  return short === null && build === null ? null : `${short ?? ''} (${build ?? ''})`
}

/**
 * Copies the executables, the helper apps, the Electron framework and the Info.plist of the
 * default app into the profile app again when their versions differ. Its own Info.plist records
 * the version of its copies. The profile's data, Resources links and icon files stay. The new
 * bundle is built next to the app and then swapped in, so a failure leaves the app as it was.
 * Returns false when the versions are equal or the default app's version is unreadable.
 */
export function refreshAppProfileBundle(
  appPath: string,
  defaultApp: string,
  run: RunTool
): boolean {
  const ownPlist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  const source = join(defaultApp, 'Contents')
  const target = versionOf(readFileSync(join(source, 'Info.plist'), 'utf8'))
  if (target === null || target === versionOf(ownPlist)) {
    return false
  }
  const id = readPlistString(ownPlist, APP_PROFILE_PLIST_ID_KEY)
  const bundleId = readPlistString(ownPlist, 'CFBundleIdentifier')
  const name = readPlistString(ownPlist, 'CFBundleDisplayName')
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
    const helpers = copyAppRuntime(source, contents, executable, run)
    // A Resources entry that the new version adds gets its link.
    for (const entry of readdirSync(join(source, 'Resources'))) {
      if (!exists(join(contents, 'Resources', entry))) {
        symlinkSync(join(source, 'Resources', entry), join(contents, 'Resources', entry))
      }
    }
    applyProfilePlist(plistPath, { bundleId, name, id, root }, run)
    signProfileBundle(next, defaultApp, bundleId, helpers, staging, run)
    const old = join(staging, 'old.app')
    renameSync(appPath, old)
    try {
      renameSync(next, appPath)
    } catch (error) {
      renameSync(old, appPath)
      throw error
    }
    return true
  } catch (error) {
    throw new RuntimeClientError(
      'profile_refresh_failed',
      `Orca could not update the profile app ${appPath}: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
