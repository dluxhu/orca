// Each app profile has its own `~/.orca` and agent folders. See docs/fork/profiles-design.md, section 3.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Overrides `~/.orca`. Only an app profile sets it. */
export const ORCA_HOME_DIR_ENV = 'ORCA_HOME_DIR'
/** The variables that an app profile set, comma-separated, so another selection can replace them. */
export const APP_PROFILE_ENV_KEYS_ENV = 'ORCA_APP_PROFILE_ENV_KEYS'

/**
 * Agent CLIs that read their folder from a variable (checked in each CLI's docs or source), and the
 * profile's subfolder for each. Agents without such a variable, and Pi, OMP, Prime Agent and
 * OpenCode (Orca rewrites their variables per pane, or they move only with XDG), read the real
 * home: the isAppProfileRuntime() checks guard them.
 */
export const APP_PROFILE_AGENT_HOME_VARIABLES = {
  CLAUDE_CONFIG_DIR: 'claude',
  CODEX_HOME: 'codex',
  GROK_HOME: 'grok',
  COPILOT_HOME: 'copilot',
  HERMES_HOME: 'hermes',
  KIMI_CODE_HOME: 'kimi-code',
  KIRO_HOME: 'kiro',
  OPENCLAW_STATE_DIR: 'openclaw',
  MIMOCODE_HOME: 'mimocode',
  // Gemini CLI makes its `.gemini` folder inside this one.
  GEMINI_CLI_HOME: 'gemini',
  QWEN_HOME: 'qwen',
  QODER_CONFIG_DIR: 'qoder',
  CODEBUDDY_CONFIG_DIR: 'codebuddy',
  CLINE_DIR: 'cline'
} as const

// Variables that name the folder that holds the agent's dot folder, not the dot folder itself.
const PARENT_FOLDER_VARIABLES: ReadonlySet<string> = new Set(['GEMINI_CLI_HOME'])

export type AppProfileAgentHomeVariable = keyof typeof APP_PROFILE_AGENT_HOME_VARIABLES

/** The profile's home folders, all under `<userData>/orca-home`. */
export function appProfileHomeEnv(userDataPath: string): Record<string, string> {
  const base = join(userDataPath, 'orca-home')
  return {
    [ORCA_HOME_DIR_ENV]: base,
    ...Object.fromEntries(
      Object.entries(APP_PROFILE_AGENT_HOME_VARIABLES).map(([key, dir]) => [
        key,
        join(base, 'agents', dir)
      ])
    )
  }
}

/** Removes the variables that a profile set, for example before another profile is selected. */
export function clearAppProfileHomeEnv(env: NodeJS.ProcessEnv): void {
  for (const key of (env[APP_PROFILE_ENV_KEYS_ENV] ?? '').split(',').filter(Boolean)) {
    delete env[key]
  }
  delete env[APP_PROFILE_ENV_KEYS_ENV]
}

/**
 * Points `~/.orca` and the agent folders at the profile. A value that the user set stays; a value
 * that another profile set is replaced. Children (terminals, serve, orcad, agents) inherit it.
 */
export function applyAppProfileHomeEnv(userDataPath: string, env: NodeJS.ProcessEnv): void {
  clearAppProfileHomeEnv(env)
  const applied: string[] = []
  for (const [key, value] of Object.entries(appProfileHomeEnv(userDataPath))) {
    if (!env[key]) {
      env[key] = value
      applied.push(key)
    }
  }
  env[APP_PROFILE_ENV_KEYS_ENV] = applied.join(',')
}

/** Applies a profile's folders, or with null clears the folders that a profile set. */
export function applyAppProfileHomes(userDataPath: string | null, env: NodeJS.ProcessEnv): void {
  if (userDataPath) {
    applyAppProfileHomeEnv(userDataPath, env)
  } else {
    clearAppProfileHomeEnv(env)
  }
}

/** `~/.orca` of this machine's user, or the profile's. Another home (a remote host) keeps its own. */
export function orcaHomeDir(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[ORCA_HOME_DIR_ENV]?.trim()
  return override && resolve(home) === resolve(homedir()) ? override : join(home, '.orca')
}

/** An agent's folder that a profile set; else the folder in the user's home. */
export function defaultAgentHomeDir(
  variable: AppProfileAgentHomeVariable,
  homeRelative: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromProfile = (env[APP_PROFILE_ENV_KEYS_ENV] ?? '').split(',').includes(variable)
  const value = fromProfile ? env[variable]?.trim() : undefined
  if (!value) {
    return join(homedir(), homeRelative)
  }
  return PARENT_FOLDER_VARIABLES.has(variable) ? join(value, homeRelative) : value
}

/** Claude's global state file: in CLAUDE_CONFIG_DIR when a profile set it, else `~/.claude.json`. */
export function defaultClaudeJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromProfile = (env[APP_PROFILE_ENV_KEYS_ENV] ?? '').split(',').includes('CLAUDE_CONFIG_DIR')
  const dir = fromProfile ? env.CLAUDE_CONFIG_DIR?.trim() : undefined
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
}
