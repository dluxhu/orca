// `orca --profile <id> <command>`: see docs/fork/profiles-design.md, section 6.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  appProfilesRoot,
  readAppProfileMarker,
  readAppProfileRegistry,
  readPlistString
} from '../../shared/app-profiles/app-profile-paths'
import { RuntimeClientError } from '../runtime/connection/types'

/**
 * Removes a `--profile <id>` that comes before the command and points the CLI at that profile.
 * After the command, `--profile` keeps its browser meaning. Order: --profile, ORCA_PROFILE,
 * ORCA_USER_DATA_PATH, the default profile. Returns the rest of argv.
 */
export function selectAppProfile(argv: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  let id: string | undefined
  let rest = argv
  if (argv[0] === '--profile') {
    id = argv[1]
    rest = argv.slice(2)
    if (!id) {
      throw new RuntimeClientError('invalid_argument', '--profile needs a profile id')
    }
  } else if (argv[0]?.startsWith('--profile=')) {
    id = argv[0].slice('--profile='.length)
    rest = argv.slice(1)
  }
  id ||= env.ORCA_PROFILE || undefined
  if (id === 'default') {
    delete env.ORCA_USER_DATA_PATH
    delete env.ORCA_APP_EXECUTABLE
  } else if (id) {
    const profiles = readAppProfileRegistry(appProfilesRoot(env))?.profiles ?? []
    const entry = profiles.find((profile) => profile.id === id)
    if (!entry) {
      const ids = ['default', ...profiles.map((profile) => profile.id)].join(', ')
      throw new RuntimeClientError('invalid_argument', `No profile "${id}". Profiles: ${ids}.`)
    }
    env.ORCA_USER_DATA_PATH = entry.userDataPath
  }
  // serve and open start the profile's own executable, so they have the profile's identity.
  const userDataPath = env.ORCA_USER_DATA_PATH
  const markerId = userDataPath ? readAppProfileMarker(userDataPath) : null
  if (userDataPath && markerId) {
    // The userData folder is <root>/<id>, so profiles.json is next to it.
    const entry = readAppProfileRegistry(dirname(userDataPath))?.profiles.find(
      (profile) => profile.id === markerId
    )
    const executable = entry ? profileExecutable(entry.appPath) : null
    if (executable) {
      env.ORCA_APP_EXECUTABLE = executable
    }
  }
  return rest
}

function profileExecutable(appPath: string): string | null {
  try {
    const name = readPlistString(
      readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8'),
      'CFBundleExecutable'
    )
    return name ? join(appPath, 'Contents', 'MacOS', name) : null
  } catch {
    return null
  }
}
