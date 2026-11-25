// A profile app after an Orca update: docs/fork/profiles-design.md, section 7.
import { dirname, join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import { refreshAppProfileBundle } from '../../cli/app-profiles/app-profile-bundle'
import { defaultAppOf, runTool } from '../../cli/app-profiles/app-profile-create'

/**
 * Runs before the profile's locks. The profile app runs its own copy of the Electron runtime, and
 * the default app's app.asar. When the default app's runtime parts change (templateKeyOf), the app
 * copies the new runtime into its bundle and starts again. True: the app exits now.
 */
export function refreshOutdatedProfileApp(
  userDataPath: string,
  deps = { refresh: refreshAppProfileBundle }
): boolean {
  const bundle = resolve(dirname(process.execPath), '..', '..')
  const checkFile = join(userDataPath, 'profile-runtime-check.txt')
  try {
    if (!deps.refresh(bundle, defaultAppOf(bundle), runTool, checkFile)) {
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
  app.relaunch()
  app.exit(0)
  return true
}
