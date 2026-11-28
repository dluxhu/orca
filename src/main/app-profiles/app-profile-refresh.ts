// A profile app after an Orca update: docs/fork/profiles-design.md, section 7.
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import { refreshAppProfileBundle } from '../../cli/app-profiles/app-profile-bundle-refresh'
import { defaultAppOf, runTool } from '../../cli/app-profiles/app-profile-create'

/** Starts the bundle again after this process exits; a detached shell outlives it. */
function startAgainAfterExit(bundle: string): void {
  // app.relaunch() would use the helper path of the old CFBundleName, which a refresh renames.
  spawn(
    '/bin/sh',
    [
      '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open -n "$0"',
      bundle,
      String(process.pid)
    ],
    { detached: true, stdio: 'ignore' }
  ).unref()
}

/**
 * A serve start: a refresh signs the bundle again, and the new signature makes macOS ask once for
 * the Keychain item, a prompt that a headless server would wait on. So serve only logs that the
 * profile app is out of date; its next desktop start refreshes it. True: a refresh is due.
 */
export function noteOutdatedServingProfileApp(
  userDataPath: string,
  deps: { refresh?: typeof refreshAppProfileBundle; log?: (line: string) => void } = {}
): boolean {
  const refresh = deps.refresh ?? refreshAppProfileBundle
  const log = deps.log ?? console.warn
  const bundle = resolve(dirname(process.execPath), '..', '..')
  const checkFile = join(userDataPath, 'profile-runtime-check.txt')
  try {
    const options = { checkFile, userDataPath, checkOnly: true }
    if (!refresh(bundle, defaultAppOf(bundle), runTool, options)) {
      return false
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log(`[profile] Could not check the profile app ${bundle}: ${reason}`)
    return false
  }
  log(
    `[profile] The profile app ${bundle} runs an older Orca runtime; this server keeps it. ` +
      'To update it, open the profile app once (from Finder or the Dock): it updates itself, ' +
      'stops this server while it runs, and starts a serve service again when it quits. ' +
      "macOS then asks once for the profile's Keychain item; choose Always Allow."
  )
  return true
}

/**
 * Runs before the profile's locks. The profile app runs its own copy of the Electron runtime, and
 * the default app's app.asar. When the default app's runtime parts change (templateKeyOf), the app
 * copies the new runtime into its bundle and starts again. True: the app exits now.
 * `serve`: only noteOutdatedServingProfileApp runs.
 */
export function refreshOutdatedProfileApp(
  userDataPath: string,
  serve = false,
  deps: { refresh?: typeof refreshAppProfileBundle; startAgain?: (bundle: string) => void } = {}
): boolean {
  if (serve) {
    noteOutdatedServingProfileApp(userDataPath, { refresh: deps.refresh })
    return false
  }
  const refresh = deps.refresh ?? refreshAppProfileBundle
  const startAgain = deps.startAgain ?? startAgainAfterExit
  const bundle = resolve(dirname(process.execPath), '..', '..')
  const checkFile = join(userDataPath, 'profile-runtime-check.txt')
  try {
    if (!refresh(bundle, defaultAppOf(bundle), runTool, { checkFile, userDataPath })) {
      return false
    }
  } catch (error) {
    // The bundle is as it was: the app starts with its old runtime.
    dialog.showErrorBox(
      'Orca could not update this profile app',
      `${error instanceof Error ? error.message : String(error)}\n\nIt starts with its old version.`
    )
    return false
  }
  startAgain(bundle)
  app.exit(0)
  return true
}
