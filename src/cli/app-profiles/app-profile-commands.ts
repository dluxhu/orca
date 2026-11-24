// `orca profiles create|rename|set-icon|icon-preview|icon-parts|set-port|remove|list|manager`: local
// commands.
// See docs/fork/profiles-design.md, section 6.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  appProfilesRoot,
  PROFILE_MANAGER_ARG,
  profileManagerAppPath,
  readAppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { getMacAppBundlePath } from '../runtime/serve/updates/mac-app-update-bundle'
import { getPackagedElectronExecutable } from '../runtime/app-launch/packaged-cli-interpreter'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import { RuntimeClientError } from '../runtime/connection/types'
import { createAppProfile, defaultAppOf } from './app-profile-create'
import {
  appProfileIconParts,
  appProfileIconSourceFromFlags,
  makeAppProfileIcon
} from './app-profile-icon'
import { encodePng, largestIcnsPng } from './app-profile-icns'
import { setAppProfileIcon } from './app-profile-set-icon'
import { renameAppProfile, setAppProfilePort } from './app-profile-edit'
import { removeAppProfile } from './app-profile-remove'
import { setDefaultAppPort } from './app-profile-default-port'
import { listAppProfiles } from './app-profile-list'

const USAGE = `Usage:
  orca profiles create <name> [--id <id>] [--port <port>] [--icon-badge <char>] [--icon-style <style>]
      [--icon-image <file>] [--icon-file <file>]
  orca profiles rename <id> --name <name>
  orca profiles set-icon <id> [--icon-badge <char>] [--icon-style <style>] [--icon-image <file>]
      [--icon-file <file>]
  orca profiles icon-preview [--id <id>] [--icon-…] --json
  orca profiles icon-parts [--id <id>] [--icon-badge <char> | --icon-image <file>] --json
  orca profiles set-port <id|default> --port <port>
  orca profiles remove <id> [--keep-data]
  orca profiles list [--json]
  orca profiles manager`

type Parsed = { positional: string[]; values: Map<string, string>; flags: Set<string> }

const VALUE_FLAGS = new Set([
  '--id',
  '--port',
  '--name',
  '--settings-file',
  '--icon-badge',
  '--icon-style',
  '--icon-image',
  '--icon-file'
])

function parse(argv: string[]): Parsed {
  const parsed: Parsed = { positional: [], values: new Map(), flags: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i]
      if (value === undefined) {
        throw new RuntimeClientError('invalid_argument', `${arg} needs a value.\n${USAGE}`)
      }
      parsed.values.set(arg, value)
    } else if (arg.startsWith('--')) {
      parsed.flags.add(arg)
    } else {
      parsed.positional.push(arg)
    }
  }
  return parsed
}

function portOf(parsed: Parsed): number | undefined {
  const raw = parsed.values.get('--port')
  return raw === undefined ? undefined : Number(raw)
}

/** The default app of the app that runs this CLI. */
function runningDefaultApp(): string {
  // On the bundled Node, the launcher names the app executable.
  const executable = getPackagedElectronExecutable() ?? process.execPath
  const appPath = getMacAppBundlePath(executable)
  if (!appPath) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Run this command with the orca CLI of an Orca app.'
    )
  }
  return defaultAppOf(appPath)
}

function print(result: unknown, json: boolean, text: string): void {
  process.stdout.write(json ? `${JSON.stringify({ ok: true, result }, null, 2)}\n` : `${text}\n`)
}

function iconOf(parsed: Parsed): ReturnType<typeof appProfileIconSourceFromFlags> {
  return appProfileIconSourceFromFlags((flag) => parsed.values.get(flag))
}

function oneId(parsed: Parsed): string {
  if (parsed.positional.length !== 1) {
    throw new RuntimeClientError('invalid_argument', USAGE)
  }
  return parsed.positional[0]
}

/**
 * The `open` arguments of `orca profiles manager`: the Profile Manager app, which `open` starts
 * once and brings to the front after that. A default app without it opens its own window.
 */
export function profileManagerOpenArgs(
  defaultApp: string,
  exists: (path: string) => boolean = existsSync
): string[] {
  const managerApp = profileManagerAppPath(defaultApp)
  // The app is always args[1]. -n starts a second process: it gives the argument to the running
  // app and exits.
  return exists(managerApp)
    ? ['-a', managerApp]
    : ['-a', defaultApp, '-n', '--args', PROFILE_MANAGER_ARG]
}

export async function runProfilesCommand(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  const parsed = parse(rest)
  const json = parsed.flags.has('--json')
  if (process.platform !== 'darwin') {
    throw new RuntimeClientError('unsupported_platform', 'Profiles are only on macOS.')
  }
  switch (command) {
    case 'create': {
      const entry = createAppProfile({
        name: oneId(parsed),
        id: parsed.values.get('--id'),
        port: portOf(parsed),
        settingsFile: parsed.values.get('--settings-file'),
        icon: iconOf(parsed),
        defaultAppPath: runningDefaultApp(),
        // --pin-root: test runs with ORCA_PROFILES_ROOT; an inherited root must not stick in a bundle.
        pinRoot: parsed.flags.has('--pin-root')
      })
      print(entry, json, JSON.stringify(entry, null, 2))
      return
    }
    case 'rename': {
      const name = parsed.values.get('--name')
      if (name === undefined) {
        throw new RuntimeClientError('invalid_argument', USAGE)
      }
      const entry = await renameAppProfile({ id: oneId(parsed), name })
      const service = {
        none: `No serve service of Orca names this profile. A service of your own that starts "${entry.appPath}" by its old path needs the new path.`,
        updated: 'The serve service now starts the app by its new path.',
        restarted: 'The serve service now starts the app by its new path. It runs again.',
        removed: ''
      }[entry.serveService]
      print(entry, json, `Renamed "${entry.id}" to "${entry.name}": ${entry.appPath}\n${service}`)
      return
    }
    case 'set-icon': {
      const entry = await setAppProfileIcon(oneId(parsed), iconOf(parsed) ?? { kind: 'badge' })
      print(entry, json, `The icon of "${entry.id}" is new.`)
      return
    }
    case 'icon-preview': {
      // The Profile Manager's preview. The profile of --id does not block its own badge.
      const registry = readAppProfileRegistry(appProfilesRoot())
      const id = parsed.values.get('--id')
      const made = makeAppProfileIcon(
        registry?.defaultAppPath ?? runningDefaultApp(),
        iconOf(parsed) ?? { kind: 'badge' },
        (registry?.profiles ?? []).filter((p) => p.id !== id).map((p) => p.icon)
      )
      const png = largestIcnsPng(made.icns)?.toString('base64') ?? ''
      print({ png, icon: made.icon }, json, JSON.stringify(made.icon))
      return
    }
    case 'icon-parts': {
      // The base icon and the badge image, as PNG. The Profile Manager renders the styles from them.
      const registry = readAppProfileRegistry(appProfilesRoot())
      const id = parsed.values.get('--id')
      const source = iconOf(parsed) ?? { kind: 'badge' }
      if (source.kind === 'file') {
        throw new RuntimeClientError('invalid_argument', 'An own icon file has no badge.')
      }
      const parts = appProfileIconParts(
        registry?.defaultAppPath ?? runningDefaultApp(),
        source,
        (registry?.profiles ?? []).filter((p) => p.id !== id).map((p) => p.icon)
      )
      const png = (img: typeof parts.base): string => encodePng(img).toString('base64')
      print({ base: png(parts.base), badge: png(parts.badge) }, json, parts.text)
      return
    }
    case 'set-port': {
      const port = portOf(parsed)
      if (port === undefined) {
        throw new RuntimeClientError('invalid_argument', USAGE)
      }
      const id = oneId(parsed)
      const entry =
        id.toLowerCase() === 'default'
          ? await setDefaultAppPort({ port, defaultUserDataPath: getPlatformUserDataPath() })
          : await setAppProfilePort({ id, port })
      const note =
        entry.serveService === 'restarted'
          ? '\nThe serve service runs again, on the new port.'
          : entry.serveService === 'updated'
            ? '\nThe serve service uses the new port from its next start.'
            : entry.serveServiceInstalled
              ? `\nInstall the serve service again: orca --profile ${entry.id} serve service install --port ${entry.port}`
              : ''
      print(entry, json, `The port of "${entry.id}" is ${entry.port}.${note}`)
      return
    }
    case 'remove': {
      const keepData = parsed.flags.has('--keep-data')
      const result = await removeAppProfile({ id: oneId(parsed), keepData })
      print(
        result,
        json,
        `Removed "${result.id}". The app${keepData ? ' is' : ' and its data are'} in the Trash.`
      )
      return
    }
    case 'list': {
      const rows = await listAppProfiles({
        defaultAppPath:
          readAppProfileRegistry(appProfilesRoot())?.defaultAppPath ?? runningDefaultApp(),
        defaultUserDataPath: getPlatformUserDataPath()
      })
      print(
        rows,
        json,
        rows
          .map((row) => `${row.id}\t${row.name}\t${row.state}\t${row.port}\t${row.appPath}`)
          .join('\n')
      )
      return
    }
    case 'manager': {
      const defaultApp =
        readAppProfileRegistry(appProfilesRoot())?.defaultAppPath ?? runningDefaultApp()
      const args = profileManagerOpenArgs(defaultApp)
      execFileSync('/usr/bin/open', args)
      print({ opened: args[1] }, json, `Opened the Profile Manager: ${args[1]}`)
      return
    }
    default:
      throw new RuntimeClientError('invalid_argument', USAGE)
  }
}
