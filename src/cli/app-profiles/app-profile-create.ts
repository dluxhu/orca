// `orca profiles create <name> [--port N] [--icon-…]`: makes the thin profile bundle of
// docs/fork/profiles-design.md, sections 1 and 2. Hidden while profiles are a prototype.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  APP_PROFILE_PLIST_ID_KEY,
  APP_PROFILE_PLIST_ROOT_KEY,
  appProfilesAppsDir,
  appProfilesRoot,
  ensureAppProfileMarker,
  readAppProfileRegistry,
  readPlistString,
  type AppProfileEntry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { getMacAppBundlePath } from '../runtime/serve/updates/mac-app-update-bundle'
import { getPackagedElectronExecutable } from '../runtime/app-launch/packaged-cli-interpreter'
import { RuntimeClientError } from '../runtime/connection/types'
import { withRegistryLock, writeRegistry } from './app-profile-registry'
import {
  appIconFileName,
  appProfileIconSourceFromFlags,
  keepProfileIcon,
  makeAppProfileIcon,
  type AppProfileIconSource
} from './app-profile-icon'

export const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const NOTIFICATION_HELPER = 'orca-notification-status'
const ELECTRON_FRAMEWORK = 'Electron Framework.framework'
// The default app uses 6768 and its fallback ladder up to 6799.
const DEFAULT_APP_PORTS = { first: 6768, last: 6799 }
const PROFILE_PORT_BASE = 6800
const PORT_SPACING = 32

/** Runs a tool and returns its stdout; throws when it fails. */
export type RunTool = (program: string, args: string[]) => string

export const runTool: RunTool = (program, args) =>
  execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export type CreateAppProfileOptions = {
  name: string
  port?: number
  /** The default: a badge with the first free character, in the ref-match style. */
  icon?: AppProfileIconSource
  defaultAppPath: string
  /** Test runs only: write the profiles root into Info.plist, so a Dock launch finds a test root. */
  pinRoot?: boolean
  env?: NodeJS.ProcessEnv
  home?: string
  run?: RunTool
  /** Tests only: the icon renderer. */
  makeIcon?: typeof makeAppProfileIcon
  now?: () => number
}

export function appProfileIdFromName(name: string): string {
  return (
    name
      .toLowerCase()
      // A bundle id has no `_`, so `a_b` and `a-b` are one id.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

/** The first port of the 6800, 6832, … series that no profile uses. */
export function nextAppProfilePort(profiles: readonly AppProfileEntry[]): number {
  let port = PROFILE_PORT_BASE
  while (profiles.some((profile) => Math.abs(profile.port - port) < PORT_SPACING)) {
    port += PORT_SPACING
  }
  return port
}

function validatePort(port: number, profiles: readonly AppProfileEntry[]): void {
  const inLadder = (base: number, last: number): boolean => port >= base && port <= last
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RuntimeClientError('invalid_argument', `--port must be 1024 to 65535: ${port}`)
  }
  const clash =
    inLadder(DEFAULT_APP_PORTS.first, DEFAULT_APP_PORTS.last) ||
    profiles.some((profile) => Math.abs(profile.port - port) < PORT_SPACING)
  if (clash) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--port ${port} is inside the port range of the default app or of another profile.`
    )
  }
}

/** Builds and signs the profile app, writes its marker and adds it to profiles.json. */
export function createAppProfile(options: CreateAppProfileOptions): AppProfileEntry {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const run = options.run ?? runTool
  const name = options.name.trim()
  const id = appProfileIdFromName(name)
  if (!name || !id || name.includes('/')) {
    throw new RuntimeClientError('invalid_argument', `Not a profile name: "${options.name}"`)
  }
  const root = resolve(appProfilesRoot(env, home))
  const appsDir = resolve(appProfilesAppsDir(env, home))
  const defaultApp = defaultAppOf(resolve(options.defaultAppPath))
  const source = join(defaultApp, 'Contents')
  mkdirSync(root, { recursive: true })
  mkdirSync(appsDir, { recursive: true })

  return withRegistryLock(root, () => {
    const registry: AppProfileRegistry = readAppProfileRegistry(root) ?? {
      version: 1,
      defaultAppPath: defaultApp,
      urlHandler: { mode: 'ask' },
      profiles: []
    }
    if (registry.profiles.some((profile) => profile.id === id)) {
      throw new RuntimeClientError('invalid_argument', `The profile "${id}" exists.`)
    }
    const port = options.port ?? nextAppProfilePort(registry.profiles)
    validatePort(port, registry.profiles)
    const appPath = join(appsDir, `${name}.app`)
    if (existsSync(appPath)) {
      throw new RuntimeClientError('invalid_argument', `${appPath} exists.`)
    }
    const template = join(source, 'Resources', 'profile-template', NOTIFICATION_HELPER)
    if (!existsSync(template)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `${defaultApp} has no profile notification helper. It is too old for profiles.`
      )
    }

    // Build in a temporary folder and move the bundle in place when it is complete.
    const staging = mkdtempSync(join(appsDir, `.${id}.staging-`))
    try {
      const bundle = join(staging, `${name}.app`)
      const contents = join(bundle, 'Contents')
      for (const folder of ['MacOS', 'Frameworks', 'Resources']) {
        mkdirSync(join(contents, folder), { recursive: true })
      }
      const plistPath = join(contents, 'Info.plist')
      run('/usr/bin/ditto', [join(source, 'Info.plist'), plistPath])
      run('/usr/bin/plutil', ['-convert', 'xml1', plistPath])
      if (existsSync(join(source, 'PkgInfo'))) {
        run('/usr/bin/ditto', [join(source, 'PkgInfo'), join(contents, 'PkgInfo')])
      }
      const defaultPlist = readFileSync(plistPath, 'utf8')
      const defaultAppId = readPlistString(defaultPlist, 'CFBundleIdentifier')
      const executable = readPlistString(defaultPlist, 'CFBundleExecutable')
      if (!defaultAppId || !executable) {
        throw new RuntimeClientError('invalid_argument', `${defaultApp} has no bundle id.`)
      }
      const bundleId = `${defaultAppId}.profile.${id}`

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
      for (const entry of readdirSync(join(source, 'Resources'))) {
        symlinkSync(join(source, 'Resources', entry), join(contents, 'Resources', entry))
      }
      // The icon is a real file, so the seal covers it and the Dock shows it.
      const made = (options.makeIcon ?? makeAppProfileIcon)(
        defaultApp,
        options.icon ?? { kind: 'badge' },
        registry.profiles.map((profile) => profile.icon)
      )
      const iconPath = join(contents, 'Resources', appIconFileName(defaultPlist))
      rmSync(iconPath, { force: true })
      writeFileSync(iconPath, made.icns)

      const plutil = (...args: string[]): void => {
        run('/usr/bin/plutil', [...args, plistPath])
      }
      plutil('-replace', 'CFBundleIdentifier', '-string', bundleId)
      plutil('-replace', 'CFBundleDisplayName', '-string', name)
      plutil('-replace', APP_PROFILE_PLIST_ID_KEY, '-string', id)
      if (options.pinRoot) {
        plutil('-replace', APP_PROFILE_PLIST_ROOT_KEY, '-string', root)
      }
      // Only the Profile Manager takes orca: links. The asar integrity fuse is off.
      for (const key of ['CFBundleURLTypes', 'ElectronAsarIntegrity']) {
        if (readPlistKeyExists(readFileSync(plistPath, 'utf8'), key)) {
          plutil('-remove', key)
        }
      }

      // Ad hoc, no --deep (the helper apps keep their signatures), no hardened runtime
      // (library validation would refuse the default app's frameworks).
      const entitlements = join(staging, 'entitlements.plist')
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
      // The marker comes first: a launchable app always finds its profile. A later failure
      // removes the app, so a retry with the same name works.
      const userDataPath = join(root, id)
      ensureAppProfileMarker(userDataPath, id)
      keepProfileIcon(userDataPath, made)
      const entry: AppProfileEntry = {
        id,
        name,
        bundleId,
        appPath,
        userDataPath,
        port,
        icon: made.icon,
        createdAt: (options.now ?? Date.now)()
      }
      renameSync(bundle, appPath)
      try {
        run(LSREGISTER, ['-f', appPath])
        writeRegistry(root, { ...registry, profiles: [...registry.profiles, entry] })
      } catch (error) {
        rmSync(appPath, { recursive: true, force: true })
        throw error
      }
      return entry
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  })
}

/** A profile's `orca` runs in the profile app; its app.asar link points into the default app. */
function defaultAppOf(appPath: string): string {
  const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  if (readPlistString(plist, APP_PROFILE_PLIST_ID_KEY) === null) {
    return appPath
  }
  return resolve(realpathSync(join(appPath, 'Contents', 'Resources', 'app.asar')), '..', '..', '..')
}

function readPlistKeyExists(xml: string, key: string): boolean {
  return xml.includes(`<key>${key}</key>`)
}

const CREATE_USAGE =
  'Usage: orca profiles create <name> [--port N] [--icon-badge <text>] [--icon-style <style>] [--icon-color <#rrggbb>] [--icon-image <file>] [--icon-file <file>]'

/** The CLI entry: `orca profiles create <name> [--port N] [--icon-…]`. */
export function runProfilesCreate(argv: string[]): void {
  // --pin-root: test runs with ORCA_PROFILES_ROOT; an inherited root must not stick in a bundle.
  const pinRoot = argv.includes('--pin-root')
  const rest: string[] = []
  const values = new Map<string, string>()
  const args = argv.filter((arg) => arg !== '--pin-root')
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] === undefined) {
        throw new RuntimeClientError('invalid_argument', CREATE_USAGE)
      }
      values.set(args[i], args[++i])
    } else {
      rest.push(args[i])
    }
  }
  const port = values.has('--port') ? Number(values.get('--port')) : undefined
  let icon: AppProfileIconSource | undefined
  try {
    icon = appProfileIconSourceFromFlags((flag) => values.get(flag))
  } catch (error) {
    throw new RuntimeClientError('invalid_argument', (error as Error).message)
  }
  const known = [
    '--port',
    '--icon-badge',
    '--icon-style',
    '--icon-color',
    '--icon-image',
    '--icon-file'
  ]
  if (rest.length !== 1 || [...values.keys()].some((flag) => !known.includes(flag))) {
    throw new RuntimeClientError('invalid_argument', CREATE_USAGE)
  }
  if (process.platform !== 'darwin') {
    throw new RuntimeClientError('unsupported_platform', 'Profiles are only on macOS.')
  }
  // On the bundled Node, the launcher names the app executable.
  const executable = getPackagedElectronExecutable() ?? process.execPath
  const defaultAppPath = getMacAppBundlePath(executable)
  if (!defaultAppPath) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Run this command with the orca CLI of an Orca app.'
    )
  }
  const entry = createAppProfile({ name: rest[0], port, icon, defaultAppPath, pinRoot })
  process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
}
