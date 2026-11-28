// The `orca profiles` CLI of this app, as the Profile Manager runs it.
import { runProcess } from '@orca/process-host'
import { dirname, join } from 'node:path'
import { APP_PROFILES_ROOT_ENV, appProfilesRoot } from '../../shared/app-profiles/app-profile-paths'
import type { AppProfileReply } from '../../shared/app-profiles/app-profile-rules'
import { getAppProfile } from './app-profile'

/** The root of this app's profiles. A profile app with a test root keeps it. */
export function profilesRoot(): string {
  const profile = getAppProfile()
  return profile ? dirname(profile.userDataPath) : appProfilesRoot()
}

export function profilesEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [APP_PROFILES_ROOT_ENV]: profilesRoot() }
}

/** Runs the CLI of this app as Node. The reply is the CLI's `--json` output. */
export function runCli(args: string[]): Promise<AppProfileReply> {
  const cli = join(process.resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
  // No timeout: a create copies the app bundle.
  return runProcess({
    program: process.execPath,
    args: [cli, ...args],
    env: { ...profilesEnv(), ELECTRON_RUN_AS_NODE: '1' },
    timeoutMs: null
  }).then(
    ({ stdout, stderr }) => {
      try {
        return JSON.parse(stdout) as AppProfileReply
      } catch {
        return { ok: false, error: { message: stderr.trim() || 'orca failed.' } }
      }
    },
    (error: unknown) => ({
      ok: false,
      error: { message: error instanceof Error ? error.message : 'orca failed.' }
    })
  )
}
