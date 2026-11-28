// The parts of a profile app that are copies of the default app, and their refresh after an update.
// See docs/fork/profiles-design.md, sections 1, 2 and 7.
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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
/**
 * The profile app's own app folder: Electron 45 reads no asar archive through a link, so a profile
 * has no app.asar link. Electron loads Resources/app, which runs the default app's real app.asar.
 * The files never change, so an Orca update needs no new signature (and no Keychain prompt).
 */
export const PROFILE_LOADER_DIR = 'app'
const PROFILE_LOADER_PACKAGE = `${JSON.stringify({ name: 'orca', private: true, main: 'boot.js' }, null, 2)}\n`
const PROFILE_LOADER_BOOT = `'use strict'
// Orca profile app loader: runs the default app's code from its real app.asar, which the
// app.asar.unpacked link sits next to. Name and version come from there, as for the default app.
const { app } = require('electron')
const { dirname, join } = require('node:path')
const { realpathSync } = require('node:fs')
const asar = join(dirname(realpathSync(join(process.resourcesPath, 'app.asar.unpacked'))), 'app.asar')
const pkg = require(join(asar, 'package.json'))
app.setAppPath(asar)
app.setVersion(pkg.version)
app.name = pkg.productName || pkg.name
require(join(asar, pkg.main))
`

/** Writes the loader (PROFILE_LOADER_DIR) into the profile's Resources. */
function writeProfileLoader(resources: string): void {
  const dir = join(resources, PROFILE_LOADER_DIR)
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), PROFILE_LOADER_PACKAGE)
  writeFileSync(join(dir, 'boot.js'), PROFILE_LOADER_BOOT)
}

export function exists(path: string): boolean {
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
function nameHelperApp(from: string, app: string, entitlements: string, run: RunTool): void {
  const oldExecutable = basename(from, '.app')
  const executable = basename(app, '.app')
  const macos = join(app, 'Contents', 'MacOS')
  if (existsSync(join(macos, oldExecutable))) {
    renameSync(join(macos, oldExecutable), join(macos, executable))
  }
  const plist = join(app, 'Contents', 'Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleExecutable', 'CFBundleDisplayName', 'CFBundleName']) {
      run('/usr/bin/plutil', ['-replace', key, '-string', executable, plist])
    }
  }
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
  let helperIndex = 0
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
      // A fixed file name: a long profile name must not make it too long.
      const entitlements = join(scratch, `helper-${helperIndex++}.entitlements.plist`)
      nameHelperApp(from, named, entitlements, run)
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
 * Builds a new profile bundle at `bundle` from the default app, as create and refresh do: the
 * copied runtime with the helpers in the profile's name, links for every Resources entry but
 * app.asar, the loader in its place, the profile's Info.plist keys with the template key, and an
 * ad hoc signature. `beforeSign` can add
 * files to the bundle before the seal (an icon file).
 */
export function buildProfileBundle(
  defaultApp: string,
  bundle: string,
  profile: { id: string; name: string; root?: string },
  run: RunTool,
  scratch: string,
  beforeSign?: (contents: string, defaultPlist: string) => void
): { bundleId: string } {
  const source = join(defaultApp, 'Contents')
  const contents = join(bundle, 'Contents')
  mkdirSync(join(contents, 'Resources'), { recursive: true })
  const plistPath = join(contents, 'Info.plist')
  const defaultPlist = copyDefaultPlist(source, plistPath, run)
  if (existsSync(join(source, 'PkgInfo'))) {
    run('/usr/bin/ditto', [join(source, 'PkgInfo'), join(contents, 'PkgInfo')])
  }
  const defaultAppId = readPlistString(defaultPlist, 'CFBundleIdentifier')
  const executable = readPlistString(defaultPlist, 'CFBundleExecutable')
  if (!defaultAppId || !executable) {
    throw new RuntimeClientError('invalid_argument', `${defaultApp} has no bundle id.`)
  }
  const bundleId = `${defaultAppId}.profile.${profile.id}`
  const helpers = copyAppRuntime(source, contents, executable, profile.name, run)
  for (const entry of readdirSync(join(source, 'Resources'))) {
    if (entry !== 'app.asar' && entry !== PROFILE_LOADER_DIR) {
      symlinkSync(join(source, 'Resources', entry), join(contents, 'Resources', entry))
    }
  }
  writeProfileLoader(join(contents, 'Resources'))
  beforeSign?.(contents, defaultPlist)
  const templateKey = templateKeyOf(defaultApp, run)
  applyProfilePlist(plistPath, { ...profile, bundleId, templateKey }, run)
  signProfileBundle(bundle, defaultApp, bundleId, helpers, scratch, run)
  return { bundleId }
}
