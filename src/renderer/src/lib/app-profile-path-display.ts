// An app profile keeps its data in its own folder. The UI shows that folder as `$PROFILE`, not as a long path.

export const APP_PROFILE_PATH_ROOT = '$PROFILE'

/** The app profile's folder, or null in the default app. */
export function appProfileDir(): string | null {
  return window.api?.platform?.get().appProfileDir ?? null
}

/** A path in the profile's folder as `$PROFILE/...`. Other paths stay as they are. */
export function profilePathDisplay(path: string, profileDir = appProfileDir()): string {
  return profileDir && path.startsWith(`${profileDir}/`)
    ? `${APP_PROFILE_PATH_ROOT}${path.slice(profileDir.length)}`
    : path
}

/** Orca's data folder as the UI shows it. A profile sets it to `orca-home` in its folder. */
export function orcaHomeDisplay(profileDir = appProfileDir()): string {
  return profileDir ? `${APP_PROFILE_PATH_ROOT}/orca-home` : '~/.orca'
}
