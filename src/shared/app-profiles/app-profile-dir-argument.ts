// The main window gets the app profile's folder in its argv. The renderer shows paths in it as `$PROFILE/...`.
const PREFIX = '--orca-app-profile-dir='

export function formatAppProfileDirArgument(userDataPath: string): string {
  return `${PREFIX}${userDataPath}`
}

/** The app profile's folder, or null in the default app and in windows that main did not stamp. */
export function readAppProfileDirArgument(argv: readonly string[]): string | null {
  const argument = argv.find((value) => value.startsWith(PREFIX))
  return argument?.slice(PREFIX.length) || null
}
