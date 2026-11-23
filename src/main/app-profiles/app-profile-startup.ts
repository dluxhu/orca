// The start of a profile app, before the instance locks. See docs/fork/profiles-design.md, section 1.
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import {
  APP_PROFILE_SETTINGS_SEED,
  ensureAppProfileMarker
} from '../../shared/app-profiles/app-profile-paths'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { getDefaultSettings } from '../../shared/orca-profiles/constants'
import { getAppProfile, type AppProfile } from './app-profile'
import { healAppProfileAppPath } from '../../cli/app-profiles/app-profile-registry'
import { serveServiceUnitOf } from '../../cli/app-profiles/app-profile-list'

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
    healRenamedApp(profile)
  }
  // Electron takes the Keychain item name from this name: "orca-<id> Safe Storage".
  // userData is pinned already, so the name does not move it.
  app.setName(`orca-${profile.id}`)
  return profile
}

/** After a rename in Finder, the registry and Orca's own serve unit get the new app path. */
function healRenamedApp(profile: AppProfile): void {
  try {
    healAppProfileAppPath({
      root: dirname(profile.userDataPath),
      id: profile.id,
      appPath: resolve(dirname(process.execPath), '..', '..'),
      unitPath: serveServiceUnitOf(profile.userDataPath, false, homedir()).unitPath
    })
  } catch (error) {
    // The next start tries again; the app works with the old registry path.
    console.warn('[profiles] could not record the new app path:', error)
  }
}

/**
 * Applies the settings that "Copy settings from:" left for a new profile, once. The seed is plain
 * data: only an object applies, only with known settings keys, and a bad seed never stops the start.
 */
export function applyAppProfileSettingsSeed(
  userDataPath: string,
  store: { updateSettings: (updates: Partial<GlobalSettings>) => unknown }
): void {
  const seedPath = join(userDataPath, APP_PROFILE_SETTINGS_SEED)
  let raw: string
  try {
    raw = readFileSync(seedPath, 'utf8')
  } catch {
    return
  }
  try {
    const seed: unknown = JSON.parse(raw)
    if (typeof seed !== 'object' || seed === null || Array.isArray(seed)) {
      throw new Error('the seed is not an object')
    }
    const known = new Set(Object.keys(getDefaultSettings(homedir())))
    const updates = Object.fromEntries(Object.entries(seed).filter(([key]) => known.has(key)))
    store.updateSettings(updates as Partial<GlobalSettings>)
  } catch (error) {
    console.warn('[profiles] the copied settings do not apply:', error)
  } finally {
    rmSync(seedPath, { force: true })
  }
}
