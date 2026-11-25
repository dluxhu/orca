// The parts of a profile app that are copies of the default app, and their refresh after an update.
// See docs/fork/profiles-design.md, sections 1, 2 and 7.
import { createHash } from 'node:crypto'
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
/** The Info.plist key with the template key of the profile's copies (templateKeyOf). */
export const APP_PROFILE_TEMPLATE_KEY = 'OrcaProfileTemplateKey'

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Gives a copied Electron helper app the profile's name. Electron finds its helpers as
 * Frameworks/<CFBundleName> Helper*.app, and macOS shows CFBundleName in bold in the menu bar.
 * The helper is signed again ad hoc with its own entitlements (the renderer needs JIT).
 */
function nameHelperApp(from: string, app: string, scratch: string, run: RunTool): void {
  const oldExecutable = basename(from, '.app')
  const executable = basename(app, '.app')
  const macos = join(app, 'Contents', 'MacOS')
  if (existsSync(join(macos, oldExecutable))) {
    renameSync(join(macos, oldExecutable), join(macos, executable))
  }
  const plist = join(app, 'Contents', 'Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleExecutable', 'CFBundleDisplayName']) {
      run('/usr/bin/plutil', ['-replace', key, '-string', executable, plist])
    }
  }
  const entitlements = join(scratch, `${executable}.entitlements.plist`)
  writeFileSync(
    entitlements,
    run('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', from])
  )
  run('/usr/bin/codesign', ['--force', '-s', '-', '--entitlements', entitlements, app])
}

/**
 * Copies the executables and the Frameworks of the default app into the profile's `contents`.
 * The helper apps get the profile's `name` (nameHelperApp). Returns the executables in MacOS other
 * than the main one.
 */
export function copyAppRuntime(
  source: string,
  contents: string,
  executable: string,
  name: string,
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
  const defaultName = readPlistString(
    readFileSync(join(source, 'Info.plist'), 'utf8'),
    'CFBundleName'
  )
  const helperPrefix = `${defaultName} Helper`
  // The bundle folder: the helpers' entitlement files stay out of the signed bundle.
  const scratch = dirname(dirname(contents))
  for (const entry of readdirSync(join(source, 'Frameworks'))) {
    const from = join(source, 'Frameworks', entry)
    const to = join(contents, 'Frameworks', entry)
    if (entry.endsWith('.app') && defaultName && entry.startsWith(helperPrefix)) {
      const named = join(
        contents,
        'Frameworks',
        `${name} Helper${entry.slice(helperPrefix.length)}`
      )
      run('/usr/bin/ditto', [from, named])
      nameHelperApp(from, named, scratch, run)
    } else if (entry.endsWith('.app')) {
      run('/usr/bin/ditto', [from, to])
    } else if (entry === ELECTRON_FRAMEWORK) {
      run('/bin/cp', ['-cR', from, to])
    } else {
      symlinkSync(from, to)
    }
  }
  return helpers
}

export type ProfilePlistKeys = {
  bundleId: string
  name: string
  id: string
  root?: string
  templateKey: string
}

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
  // The bold name in the menu bar. The helper apps carry it too (copyAppRuntime).
  plutil('-replace', 'CFBundleName', '-string', keys.name)
  plutil('-replace', APP_PROFILE_PLIST_ID_KEY, '-string', keys.id)
  plutil('-replace', APP_PROFILE_TEMPLATE_KEY, '-string', keys.templateKey)
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

/** The cdhash of a signed executable: it does not change with a new signature of the same code. */
function codeHashOf(path: string, run: RunTool): string {
  const out = run('/bin/sh', ['-c', '/usr/bin/codesign -dvvv "$0" 2>&1 || true', path])
  return (
    /CDHash=([0-9a-f]+)/.exec(out)?.[1] ??
    createHash('sha256').update(readFileSync(path)).digest('hex')
  )
}

/**
 * A hash of the parts of the default app that a profile copies or links: the Electron version, the
 * code of each executable in MacOS and of the profile's notification helper, and the names in
 * Frameworks and Resources. An update that changes none of them needs no new copies, and so no
 * new signature (which makes the Keychain ask again).
 */
export function templateKeyOf(defaultApp: string, run: RunTool): string {
  const source = join(defaultApp, 'Contents')
  const hash = createHash('sha256')
  let electron = ''
  try {
    const plist = join(source, 'Frameworks', ELECTRON_FRAMEWORK, 'Resources', 'Info.plist')
    electron = readPlistString(readFileSync(plist, 'utf8'), 'CFBundleVersion') ?? ''
  } catch {
    // No framework plist: the executables decide.
  }
  hash.update(`electron ${electron}\n`)
  for (const entry of readdirSync(join(source, 'MacOS')).sort()) {
    hash.update(`${entry} ${codeHashOf(join(source, 'MacOS', entry), run)}\n`)
  }
  const template = join(source, 'Resources', 'profile-template', NOTIFICATION_HELPER)
  hash.update(`template ${existsSync(template) ? codeHashOf(template, run) : ''}\n`)
  for (const folder of ['Frameworks', 'Resources']) {
    hash.update(`${folder} ${readdirSync(join(source, folder)).sort().join('/')}\n`)
  }
  return hash.digest('hex').slice(0, 32)
}

/**
 * Copies the executables, the helper apps, the Electron framework and the Info.plist of the
 * default app into the profile app again when the template key (templateKeyOf) differs from the
 * one that its own Info.plist records. The profile's data, Resources links and icon files stay.
 * The new bundle is built next to the app and then swapped in, so a failure leaves the app as it
 * was. `checkFile` keeps the default app version of the last check, so a start with the same
 * version reads no executables. Returns true when the bundle changed.
 */
export function refreshAppProfileBundle(
  appPath: string,
  defaultApp: string,
  run: RunTool,
  checkFile?: string
): boolean {
  const source = join(defaultApp, 'Contents')
  const target = versionOf(readFileSync(join(source, 'Info.plist'), 'utf8'))
  if (target === null || (checkFile && readText(checkFile) === target)) {
    return false
  }
  const ownPlist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  const templateKey = templateKeyOf(defaultApp, run)
  // A rename changes only the file name (no new signature); the menu-bar name follows here.
  const changed =
    templateKey !== readPlistString(ownPlist, APP_PROFILE_TEMPLATE_KEY) ||
    readPlistString(ownPlist, 'CFBundleName') !== basename(appPath, '.app')
  if (changed) {
    rebuild(appPath, defaultApp, ownPlist, templateKey, run)
  }
  if (checkFile) {
    try {
      writeFileSync(checkFile, target)
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
    signProfileBundle(next, defaultApp, bundleId, helpers, staging, run)
    const old = join(staging, 'old.app')
    renameSync(appPath, old)
    try {
      renameSync(next, appPath)
    } catch (error) {
      renameSync(old, appPath)
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
