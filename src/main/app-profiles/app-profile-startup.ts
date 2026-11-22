// The start of a profile app, before the instance locks. See docs/fork/profiles-design.md, section 1.
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  APP_PROFILE_SETTINGS_SEED,
  ensureAppProfileMarker
} from '../../shared/app-profiles/app-profile-paths'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { getAppProfile, type AppProfile } from './app-profile'

/** Pins the profile's own userData and writes its marker when it is missing (orcad reads only the marker). */
export function configureAppProfileStartup(isDev: boolean): AppProfile | null {
  const profile = getAppProfile()
  if (!profile) {
    return null
  }
  // With --user-data-dir, the folder already carries this profile's marker (resolveAppProfile).
  if (!isDev && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', profile.userDataPath)
    ensureAppProfileMarker(profile.userDataPath, profile.id)
  }
  // Electron takes the Keychain item name from this name: "orca-<id> Safe Storage".
  // userData is pinned already, so the name does not move it.
  app.setName(`orca-${profile.id}`)
  return profile
}

/** Applies the settings that "Copy settings from:" left for a new profile, once. */
export function applyAppProfileSettingsSeed(
  userDataPath: string,
  store: { updateSettings: (updates: Partial<GlobalSettings>) => unknown }
): void {
  const seedPath = join(userDataPath, APP_PROFILE_SETTINGS_SEED)
  let seed: Partial<GlobalSettings>
  try {
    seed = JSON.parse(readFileSync(seedPath, 'utf8')) as Partial<GlobalSettings>
  } catch {
    return
  }
  store.updateSettings(seed)
  rmSync(seedPath, { force: true })
}
