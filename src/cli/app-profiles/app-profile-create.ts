// `orca profiles create`: makes the thin profile bundle of docs/fork/profiles-design.md,
// sections 1 and 2.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
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
import { join, resolve, sep } from 'node:path'
import {
  APP_PROFILE_PLIST_ID_KEY,
  APP_PROFILE_PLIST_ROOT_KEY,
  APP_PROFILE_SETTINGS_SEED,
  appProfilesAppsDir,
  appProfilesRoot,
  ensureAppProfileMarker,
  isProfileManagerBundle,
  readAppProfileMarker,
  readAppProfileRegistry,
  readPlistString,
  type AppProfileEntry,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import {
  appProfileIdError,
  appProfileIdFromName,
  appProfileNameError,
  appProfilePortError,
  nextAppProfilePort
} from '../../shared/app-profiles/app-profile-rules'
import { RuntimeClientError } from '../runtime/connection/types'
import { isInside, withRegistryLock, writeRegistry } from './app-profile-registry'
import {
  appIconFileName,
  keepProfileIcon,
  makeAppProfileIcon,
  type AppProfileIconSource
} from './app-profile-icon'

export const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const NOTIFICATION_HELPER = 'orca-notification-status'
const ELECTRON_FRAMEWORK = 'Electron Framework.framework'

/** Runs a tool and returns its stdout; throws when it fails. */
export type RunTool = (program: string, args: string[]) => string

export const runTool: RunTool = (program, args) =>
  execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export type CreateAppProfileOptions = {
  name: string
  /** The automatic id comes from the name. */
  id?: string
  port?: number
  /** A JSON file of settings. The profile applies them at its first start. */
  settingsFile?: string
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

/**
 * Builds and signs the profile app, writes its marker and adds it to profiles.json. A data folder
 * that "Keep data" left for this id stays, and the new app uses it (adoptedData).
 */
export function createAppProfile(
  options: CreateAppProfileOptions
): AppProfileEntry & { adoptedData: boolean } {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const run = options.run ?? runTool
  const name = options.name.trim()
  const id = options.id ?? appProfileIdFromName(name)
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
    const ports = registry.profiles.map((profile) => profile.port)
    const port = options.port ?? nextAppProfilePort(ports)
    const error =
      appProfileNameError(
        name,
        registry.profiles.map((profile) => profile.name)
      ) ??
      appProfileIdError(
        id,
        registry.profiles.map((profile) => profile.id)
      ) ??
      appProfilePortError(port, ports)
    if (error) {
      throw new RuntimeClientError('invalid_argument', error)
    }
    const userDataPath = join(root, id)
    const keptId = keptDataFolderId(userDataPath, root, id, home)
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
      ensureAppProfileMarker(userDataPath, id)
      const seed = join(userDataPath, APP_PROFILE_SETTINGS_SEED)
      if (options.settingsFile) {
        copyFileSync(options.settingsFile, seed)
      } else {
        // Kept data can hold a seed of an earlier create; this create copies no settings.
        rmSync(seed, { force: true })
      }
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
      return { ...entry, adoptedData: keptId !== null }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  })
}

/**
 * Null for a new data folder. An existing <root>/<id> must be a real folder, inside the root, with
 * this profile's marker: the folder that "Keep data" left. The default app's data is never a
 * profile's data.
 */
function keptDataFolderId(
  userDataPath: string,
  root: string,
  id: string,
  home: string
): string | null {
  const refuse = (reason: string): never => {
    throw new RuntimeClientError('invalid_argument', `${userDataPath} ${reason} Use another id.`)
  }
  const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path)
  const defaultData = real(join(home, 'Library', 'Application Support', 'orca')).toLowerCase()
  const target = join(real(root), id).toLowerCase()
  if (target === defaultData || target.startsWith(`${defaultData}${sep}`)) {
    refuse("is the default app's data.")
  }
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(userDataPath)
  } catch {
    return null
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !isInside(userDataPath, root)) {
    refuse('exists and is not a profile data folder.')
  }
  // On a volume that ignores case, the folder of "Work" is also the folder of "work".
  const keptId = readAppProfileMarker(userDataPath)
  if (keptId === null) {
    refuse('exists and has no profile marker.')
  }
  if (keptId !== id) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${userDataPath} is the data folder of the profile "${keptId}". Use the id "${keptId}".`
    )
  }
  return keptId
}

/**
 * A profile's `orca` runs in the profile app, and the Profile Manager's in the Manager app. Their
 * app.asar link points into the default app.
 */
export function defaultAppOf(appPath: string): string {
  const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
  if (
    readPlistString(plist, APP_PROFILE_PLIST_ID_KEY) === null &&
    !isProfileManagerBundle(plist, appPath)
  ) {
    return appPath
  }
  return resolve(realpathSync(join(appPath, 'Contents', 'Resources', 'app.asar')), '..', '..', '..')
}

function readPlistKeyExists(xml: string, key: string): boolean {
  return xml.includes(`<key>${key}</key>`)
}
