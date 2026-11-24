// Self-contained functions: no imports and no outer names. The main bundle's banner runs their
// source before any module loads (config/build-plugins/app-profile-homes-banner.ts), and
// app-profile-homes.ts calls them in every other process. macOS paths only.

export type AppProfileEnvIo = {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
  homedir(): string
}

/**
 * Sets `ORCA_HOME_DIR` and the agent folder variables to the profile whose userData is
 * `userDataPath`. A profile replaces every value, also one that the user set. With null, removes
 * only a profile's values: a value under a profile's `orca-home` folder (its userData has the
 * profile marker). The default app keeps every other value.
 */
export function applyAppProfileHomesCore(
  env: NodeJS.ProcessEnv,
  userDataPath: string | null,
  variables: Record<string, string>,
  io: AppProfileEnvIo
): void {
  const isProfileValue = (value: string): boolean => {
    const match = /^(.+)\/orca-home(?:\/|$)/.exec(value)
    return match !== null && io.existsSync(`${match[1]}/orca-app-profile.json`)
  }
  for (const key of ['ORCA_HOME_DIR', ...Object.keys(variables)]) {
    const current = env[key]
    if (userDataPath === null && current && !isProfileValue(current)) {
      continue
    }
    if (userDataPath === null) {
      delete env[key]
    } else {
      env[key] =
        key === 'ORCA_HOME_DIR'
          ? `${userDataPath}/orca-home`
          : `${userDataPath}/orca-home/agents/${variables[key]}`
    }
  }
}

/**
 * The userData of the app profile this Electron process runs, read before any module loads: the
 * bundle's `OrcaAppProfileId`, else the marker in `--user-data-dir`. Null for the default app, and
 * when the given folder is not this profile's (the preflight then stops with the reason).
 * Same rules as `resolveAppProfile` (src/main/app-profiles/app-profile.ts); a test compares them.
 */
export function earlyAppProfileUserData(
  io: AppProfileEnvIo,
  execPath: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv
): string | null {
  let plist = ''
  try {
    plist = io.readFileSync(execPath.replace(/\/MacOS\/[^/]+$/, '/Info.plist'), 'utf8')
  } catch {
    plist = ''
  }
  const plistString = (key: string): string | null => {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)
    return match
      ? match[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&')
      : null
  }
  const markerId = (dir: string): string | null => {
    try {
      const id = (
        JSON.parse(io.readFileSync(`${dir}/orca-app-profile.json`, 'utf8')) as {
          id?: unknown
        }
      ).id
      return typeof id === 'string' && id ? id : null
    } catch {
      return null
    }
  }
  const switchArg = argv.find((arg) => arg.startsWith('--user-data-dir='))
  const given = switchArg ? switchArg.slice('--user-data-dir='.length) || null : null
  const id = plistString('OrcaAppProfileId')
  if (id) {
    if (given) {
      return markerId(given) === id ? given : null
    }
    const root =
      plistString('OrcaAppProfilesRoot') ??
      (env.ORCA_PROFILES_ROOT || `${io.homedir()}/Library/Application Support/Orca Profiles`)
    return `${root}/${id}`
  }
  return given && markerId(given) ? given : null
}
