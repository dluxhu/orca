import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Every writer to the shared agent folders stays off in an app profile. The home is a temp
// folder and the writers are spies, so a broken gate cannot reach the real home.
vi.mock('./app-profile', () => ({ isAppProfileRuntime: () => true, getAppProfile: () => null }))
const { openCodeRefresh } = vi.hoisted(() => ({ openCodeRefresh: vi.fn() }))
vi.mock('../opencode/status-hooks/hook-service', () => ({
  openCodeHookService: { refreshInstalledPlugins: openCodeRefresh },
  openCode2HookService: { refreshInstalledPlugins: openCodeRefresh }
}))

import { ClaudeAgentViewService } from '../claude/agent-view/agent-view-service'
import { refreshInstalledOpenCodeStatusPlugins } from '../opencode/status-hooks/opencode-status-plugin-startup-refresh'
import { startClaudeCodeThemeSync } from '../claude/theme-sync/claude-code-theme-sync-schedule'
import { runOrcaUninstallStep, type OrcaUninstallHost } from '../uninstall/orca-uninstall-cleanup'
import type { OrcaUninstallPlan } from '../../shared/uninstall/orca-uninstall-types'

let home: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-profile-writers-home-'))
  for (const key of ['HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME', 'ORCA_HOME_DIR']) {
    vi.stubEnv(key, home)
  }
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('shared agent writers in an app profile', () => {
  it('does not reconcile the Claude agent view', async () => {
    const deps = {
      reconcileConfig: vi.fn(),
      ensurePlugin: vi.fn(),
      listProfiles: vi.fn(async () => []),
      loginEnv: vi.fn(),
      claudeOnPath: vi.fn(async () => true)
    }
    await new ClaudeAgentViewService(home, deps as never).reconcile({})
    expect(Object.values(deps).filter((dep) => dep.mock.calls.length > 0)).toEqual([])
  })

  it('does not refresh the OpenCode status plugins', () => {
    refreshInstalledOpenCodeStatusPlugins({})
    expect(openCodeRefresh).not.toHaveBeenCalled()
  })

  it('does not start the Claude Code theme sync', () => {
    const host = {
      getSettings: vi.fn(() => ({})),
      onSettingsChanged: vi.fn(),
      systemPrefersDark: vi.fn(() => true),
      onSystemThemeChanged: vi.fn(),
      onAppFocused: vi.fn(),
      userDataPath: home
    }
    startClaudeCodeThemeSync(host as never)
    expect(host.getSettings).not.toHaveBeenCalled()
    expect(host.onSettingsChanged).not.toHaveBeenCalled()
  })

  it('uninstall keeps the shared hooks and scripts', async () => {
    const scripts = join(home, '.orca', 'agent-hooks')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(join(scripts, 'claude-hook.sh'), '#!/bin/sh\n')
    const plan = {
      agents: [{ agent: 'claude', paths: [], state: 'present', detail: null }],
      hookScripts: { location: scripts, state: 'present', detail: null },
      otherOrcaBuildName: null
    } as unknown as OrcaUninstallPlan
    const host = {
      homeDir: home,
      disableAgentStatusHooks: vi.fn(async () => {})
    } as unknown as OrcaUninstallHost
    const afterHooks = await runOrcaUninstallStep(plan, 'agent-hooks', host)
    expect(afterHooks.agents[0]?.state).toBe('kept-shared')
    const afterScripts = await runOrcaUninstallStep(afterHooks, 'hook-scripts', host)
    expect(afterScripts.hookScripts?.state).toBe('kept-shared')
    expect(host.disableAgentStatusHooks).not.toHaveBeenCalled()
    expect(existsSync(join(scripts, 'claude-hook.sh'))).toBe(true)
  })

  it('uninstall keeps the hook scripts when no agent entry is left', async () => {
    const scripts = join(home, '.orca', 'agent-hooks')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(join(scripts, 'codex-hook.sh'), '#!/bin/sh\n')
    const plan = {
      agents: [],
      hookScripts: { location: scripts, state: 'present', detail: null },
      otherOrcaBuildName: null
    } as unknown as OrcaUninstallPlan
    const host = { homeDir: home } as unknown as OrcaUninstallHost
    const after = await runOrcaUninstallStep(plan, 'hook-scripts', host)
    expect(after.hookScripts?.state).toBe('kept-shared')
    expect(existsSync(join(scripts, 'codex-hook.sh'))).toBe(true)
  })

  it("uninstall keeps the default app's orca command", async () => {
    const plan = {
      agents: [],
      cliCommand: {
        location: '/usr/local/bin/orca',
        commandName: 'orca',
        state: 'present',
        detail: null
      },
      otherOrcaBuildName: null
    } as unknown as OrcaUninstallPlan
    const host = { homeDir: home, removeCli: vi.fn() } as unknown as OrcaUninstallHost
    const after = await runOrcaUninstallStep(plan, 'cli-command', host)
    expect(after.cliCommand?.state).toBe('kept-shared')
    expect(
      (host as unknown as { removeCli: ReturnType<typeof vi.fn> }).removeCli
    ).not.toHaveBeenCalled()
  })
})
