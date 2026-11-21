// The start of a profile app, before the instance locks. See docs/fork/profiles-design.md, section 1.
import { app } from 'electron'
import { ensureAppProfileMarker } from '../../shared/app-profiles/app-profile-paths'
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
  return profile
}
