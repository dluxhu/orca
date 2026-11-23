// `orca profiles create|rename|set-port|remove|list|manager`: local commands, no runtime needed.
// See docs/fork/profiles-design.md, section 6.
import { execFileSync } from 'node:child_process'
import {
  appProfilesRoot,
  PROFILE_MANAGER_ARG,
  readAppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { getMacAppBundlePath } from '../runtime/serve/updates/mac-app-update-bundle'
import { getPackagedElectronExecutable } from '../runtime/app-launch/packaged-cli-interpreter'
import { getPlatformUserDataPath } from '../runtime/profile/metadata'
import { RuntimeClientError } from '../runtime/connection/types'
import { createAppProfile, defaultAppOf } from './app-profile-create'
import { renameAppProfile, setAppProfilePort } from './app-profile-edit'
import { removeAppProfile } from './app-profile-remove'
import { listAppProfiles } from './app-profile-list'

const USAGE = `Usage:
  orca profiles create <name> [--id <id>] [--port <port>]
  orca profiles rename <id> --name <name>
  orca profiles set-port <id> --port <port>
  orca profiles remove <id> [--keep-data]
  orca profiles list [--json]
  orca profiles manager`

type Parsed = { positional: string[]; values: Map<string, string>; flags: Set<string> }

const VALUE_FLAGS = new Set(['--id', '--port', '--name', '--settings-file'])

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

function oneId(parsed: Parsed): string {
  if (parsed.positional.length !== 1) {
    throw new RuntimeClientError('invalid_argument', USAGE)
  }
  return parsed.positional[0]
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
    case 'set-port': {
      const port = portOf(parsed)
      if (port === undefined) {
        throw new RuntimeClientError('invalid_argument', USAGE)
      }
      const entry = await setAppProfilePort({ id: oneId(parsed), port })
      const note =
        entry.serveService === 'updated'
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
      // -n starts a second process: it gives the argument to the running app and exits.
      execFileSync('/usr/bin/open', ['-n', '-a', defaultApp, '--args', PROFILE_MANAGER_ARG])
      print({ opened: defaultApp }, json, `Opened the Profile Manager of ${defaultApp}.`)
      return
    }
    default:
      throw new RuntimeClientError('invalid_argument', USAGE)
  }
}
