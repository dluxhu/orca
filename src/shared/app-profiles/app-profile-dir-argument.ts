// The main window gets Orca's data folders in its argv. The renderer shows and opens paths in them.
const PROFILE_DIR_PREFIX = '--orca-app-profile-dir='
const ORCA_HOME_DIR_PREFIX = '--orca-home-dir='

export function formatAppProfileDirArgument(userDataPath: string): string {
  return `${PROFILE_DIR_PREFIX}${userDataPath}`
}

export function formatOrcaHomeDirArgument(orcaHome: string): string {
  return `${ORCA_HOME_DIR_PREFIX}${orcaHome}`
}

function readArgument(argv: readonly string[], prefix: string): string | null {
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null
}

/** The app profile's folder, or null in the default app and in windows that main did not stamp. */
export function readAppProfileDirArgument(argv: readonly string[]): string | null {
  return readArgument(argv, PROFILE_DIR_PREFIX)
}

/** Orca's data folder on this computer, or null in windows that main did not stamp. */
export function readOrcaHomeDirArgument(argv: readonly string[]): string | null {
  return readArgument(argv, ORCA_HOME_DIR_PREFIX)
}
