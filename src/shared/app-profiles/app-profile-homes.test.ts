import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_PROFILE_AGENT_HOME_VARIABLES,
  applyAppProfileHomeEnv,
  applyAppProfileHomes,
  defaultAgentHomeDir,
  defaultClaudeJsonPath,
  orcaHomeDir,
  type AppProfileAgentHomeVariable
} from './app-profile-homes'

let home: string
let userData: string

// A temp HOME stands for the user's home: nothing here may resolve inside it.
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-profile-homes-'))
  userData = join(home, 'Library', 'Application Support', 'Orca Profiles', 'work')
  vi.stubEnv('HOME', home)
  for (const key of [
    'ORCA_HOME_DIR',
    'ORCA_APP_PROFILE_ENV_KEYS',
    ...Object.keys(APP_PROFILE_AGENT_HOME_VARIABLES)
  ]) {
    vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(home, { recursive: true, force: true })
})

const underProfile = (path: string): boolean => path.startsWith(userData + sep)

describe('app profile homes', () => {
  it('keep a value that the user set and replace one that another profile set', () => {
    const env: NodeJS.ProcessEnv = { CODEX_HOME: '/user/codex' }
    applyAppProfileHomeEnv('/profiles/home', env)
    expect(env.CODEX_HOME).toBe('/user/codex')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/profiles/home/orca-home/agents/claude')
    applyAppProfileHomeEnv('/profiles/work', env)
    expect(env.CLAUDE_CONFIG_DIR).toBe('/profiles/work/orca-home/agents/claude')
    expect(env.CODEX_HOME).toBe('/user/codex')
    // The default profile drops the folders that a profile set.
    applyAppProfileHomes(null, env)
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env.ORCA_HOME_DIR).toBeUndefined()
    expect(env.CODEX_HOME).toBe('/user/codex')
  })

  it('resolve every helper path under the profile folder', () => {
    applyAppProfileHomeEnv(userData, process.env)
    expect(homedir()).toBe(home)
    const paths = [
      orcaHomeDir(),
      orcaHomeDir(homedir()),
      defaultClaudeJsonPath(),
      ...(Object.keys(APP_PROFILE_AGENT_HOME_VARIABLES) as AppProfileAgentHomeVariable[]).map(
        (variable) => defaultAgentHomeDir(variable, '.agent')
      )
    ]
    expect(paths.filter((path) => !underProfile(path))).toEqual([])
    expect(defaultAgentHomeDir('GEMINI_CLI_HOME', '.gemini')).toBe(
      join(userData, 'orca-home', 'agents', 'gemini', '.gemini')
    )
    // A remote host's home keeps its own `.orca`.
    expect(orcaHomeDir('/remote/home')).toBe('/remote/home/.orca')
  })

  it('resolve the rewritten sites under the profile folder', async () => {
    applyAppProfileHomeEnv(userData, process.env)
    // Imported after the env, as the main entry does: module constants read the profile folders.
    const { getSharedManagedScriptPath } =
      await import('../../main/agent-hooks/installation/scripts/managed-hook-script-path')
    const { getUserKeybindingsPath } = await import('../../main/keybindings/keybinding-file')
    const { getSystemCodexHomePath } =
      await import('../../main/codex/configuration/homes/codex-home-paths')
    const { getWorkspaceFilePath } =
      await import('../../main/linear/accounts/linear-credential-paths')
    const { claudeProjectsHostDirs, codexHomeSessionsDir } =
      await import('../../main/ai-vault/discovery/session-scanner-roots')
    const { DEFAULT_CODEX_HOME_DIR } =
      await import('../../main/ai-vault/discovery/session-scanner-agent-sources')
    const paths = [
      getSharedManagedScriptPath('claude-hook.sh'),
      getUserKeybindingsPath(homedir()),
      getSystemCodexHomePath(),
      getWorkspaceFilePath(),
      ...claudeProjectsHostDirs(),
      codexHomeSessionsDir(),
      DEFAULT_CODEX_HOME_DIR
    ]
    expect(paths.filter((path) => !underProfile(path))).toEqual([])
  })

  it('leave the default app on the user home', () => {
    expect(orcaHomeDir()).toBe(join(home, '.orca'))
    expect(defaultAgentHomeDir('CLAUDE_CONFIG_DIR', '.claude')).toBe(join(home, '.claude'))
    expect(defaultClaudeJsonPath()).toBe(join(home, '.claude.json'))
  })
})
