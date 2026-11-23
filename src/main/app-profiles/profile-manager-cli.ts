// The `orca profiles` CLI of this app, as the Profile Manager runs it.
import { execFile } from 'node:child_process'
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
  return new Promise((done) => {
    execFile(
      process.execPath,
      [cli, ...args],
      // An icon preview is a 1024 px PNG in base64.
      { env: { ...profilesEnv(), ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        try {
          done(JSON.parse(stdout) as AppProfileReply)
        } catch {
          done({ ok: false, error: { message: error?.message ?? 'orca failed.' } })
        }
      }
    )
  })
}
