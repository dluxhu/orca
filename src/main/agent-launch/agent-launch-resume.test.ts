import { EVERY_AGENT_CHAT } from '../../shared/native-chat/every-agent-chat.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { executeAgentLaunch, type AgentLaunchExecution } from './agent-launch-executor'
import { AgentLaunchStructuredSessionRefusedError } from './agent-launch-surface-factories'
import type { AgentLaunchIntent } from '../../shared/agent-launch/contracts/agent-launch-intent'
import { computeAgentLaunchFingerprint } from '../../shared/agent-launch/contracts/agent-launch-operation'
import { resolveUnlaunchedIntent } from '../runtime/rpc/methods/agent-launch/agent-launch-intent-resolution'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const RESUME: AgentLaunchIntent = {
  agent: 'claude',
  target: { kind: 'existing', worktree: 'wt-1', workspacePath: '/repo', connectionId: null },
  surface: 'chat',
  resumeFrom: { providerSessionId: 'claude-session-1' }
}

function harness(options: { chat: boolean; createRefuses?: boolean; supportFails?: boolean }) {
  const createStructuredSession = vi.fn(async (_args: Record<string, unknown>) => {
    if (options.createRefuses) {
      throw new AgentLaunchStructuredSessionRefusedError(
        'structured_agent_session_unsupported',
        'unsupported'
      )
    }
    return { sessionId: 'sess-1', handle: 'handle_structured', fence: 1 }
  })
  const createTerminalAgent = vi.fn(async () => ({ handle: 'term_1' }))
  const runtime: AgentLaunchExecution['runtime'] = {
    requireStore: () => ({
      getSettings: () => (options.chat ? { nativeChatProviders: EVERY_AGENT_CHAT } : null)
    }),
    getStructuredAgentSessionCreateSupport: async () => {
      if (options.supportFails) {
        throw new Error('support check failed')
      }
      return { supported: options.chat }
    }
  }
  const run = () =>
    executeAgentLaunch({
      runtime,
      intent: RESUME,
      surfaces: {
        createStructuredSession,
        createTerminalAgent,
        deliverTerminalPrompt: vi.fn(async () => true)
      }
    })
  return { run, createStructuredSession, createTerminalAgent }
}

describe('agent launch that resumes a provider session', () => {
  it('opens the chat on the provider session', async () => {
    const { run, createStructuredSession, createTerminalAgent } = harness({ chat: true })
    const result = await run()
    expect(result.outcome.kind).toBe('structured')
    expect(createStructuredSession.mock.calls[0]?.[0]).toMatchObject({
      resumeFrom: { providerSessionId: 'claude-session-1' }
    })
    expect(createTerminalAgent).not.toHaveBeenCalled()
  })

  it('never starts a fresh terminal agent when the chat create is refused', async () => {
    const { run, createTerminalAgent } = harness({ chat: true, createRefuses: true })
    await expect(run()).rejects.toThrow()
    expect(createTerminalAgent).not.toHaveBeenCalled()
  })

  it('refuses before any effect when the agent cannot open as a chat', async () => {
    const { run, createStructuredSession, createTerminalAgent } = harness({ chat: false })
    await expect(run()).rejects.toThrow()
    expect(createStructuredSession).not.toHaveBeenCalled()
    expect(createTerminalAgent).not.toHaveBeenCalled()
  })

  it('refuses instead of starting a fresh terminal when chat support is unknown', async () => {
    const { run, createStructuredSession, createTerminalAgent } = harness({
      chat: true,
      supportFails: true
    })
    await expect(run()).rejects.toThrow(/resume/)
    expect(createStructuredSession).not.toHaveBeenCalled()
    expect(createTerminalAgent).not.toHaveBeenCalled()
  })

  it('carries the resumed session from agent.launch params into the intent', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: intent resolution reads only these three runtime members.
    const runtime = {
      showTerminalWorkspaceLaunchScope: async () => ({
        id: 'wt-1',
        path: '/repo',
        connectionId: null
      }),
      requireStore: () => ({ getSettings: () => ({ nativeChatProviders: EVERY_AGENT_CHAT }) }),
      getStructuredAgentSessionCreateSupport: async () => ({ supported: true })
    } as unknown as OrcaRuntimeService
    const { intent } = await resolveUnlaunchedIntent(
      {
        agent: 'claude',
        target: { kind: 'existing', worktree: 'id:wt-1' },
        surface: 'chat',
        resumeFrom: { providerSessionId: 'claude-session-1' }
      },
      runtime,
      null
    )
    expect(intent.resumeFrom).toEqual({ providerSessionId: 'claude-session-1' })
  })

  it('makes the resumed session part of the launch identity', () => {
    const base = { agent: 'claude', target: { kind: 'existing' as const, worktree: 'wt-1' } }
    expect(computeAgentLaunchFingerprint({ ...base, resumeFrom: RESUME.resumeFrom })).not.toBe(
      computeAgentLaunchFingerprint(base)
    )
  })
})
