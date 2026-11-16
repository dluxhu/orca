import { describe, expect, it, vi } from 'vitest'
import { EVERY_AGENT_CHAT } from '../../shared/native-chat/every-agent-chat.test-fixture'
import { executeAgentLaunch, type AgentLaunchExecution } from './agent-launch-executor'
import { AgentLaunchStructuredSessionRefusedError } from './agent-launch-surface-factories'
import { AgentLaunchSurfaceUnavailableError } from './agent-launch-surface-refusal'
import { launchFailureWithoutEffectsCode } from '../runtime/rpc/methods/agent-launch/agent-launch-failure-code'
import { trackTerminalSpawnDispatch } from './agent-launch-not-started'
import { launchRefusalWithoutEffects } from './agent-launch-create-refusal'

function launch(refusal: AgentLaunchStructuredSessionRefusedError) {
  const createTerminalAgent = vi.fn(async () => ({ handle: 'term_1' }))
  const runtime: AgentLaunchExecution['runtime'] = {
    requireStore: () => ({ getSettings: () => ({ nativeChatProviders: EVERY_AGENT_CHAT }) }),
    getStructuredAgentSessionCreateSupport: async () => ({ supported: true })
  }
  const run = executeAgentLaunch({
    runtime,
    intent: {
      agent: 'claude',
      target: { kind: 'existing', worktree: 'wt-1', workspacePath: '/repo', connectionId: null }
    },
    surfaces: {
      createStructuredSession: async () => {
        throw refusal
      },
      createTerminalAgent,
      deliverTerminalPrompt: vi.fn(async () => true)
    }
  })
  return { run, createTerminalAgent }
}

describe('a chat create refused before attach', () => {
  it('fails the launch as one without effects and keeps the refusal message', async () => {
    const { run, createTerminalAgent } = launch(
      new AgentLaunchStructuredSessionRefusedError(
        'agent_session_identity_required',
        'Orca cannot find that conversation.',
        true
      )
    )
    const error = await run.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AgentLaunchSurfaceUnavailableError)
    expect(error).toMatchObject({
      message: 'Orca cannot find that conversation. (agent_session_identity_required)'
    })
    expect(launchFailureWithoutEffectsCode(error, 'existing', trackTerminalSpawnDispatch())).toBe(
      'agent_launch_surface_unavailable'
    )
    expect(createTerminalAgent).not.toHaveBeenCalled()
  })

  it('keeps an outcome unknown in a new workspace, which exists before the chat', () => {
    const refusal = new AgentLaunchStructuredSessionRefusedError(
      'agent_session_identity_required',
      'Orca cannot find that conversation.',
      true
    )
    const error = launchRefusalWithoutEffects(refusal, 'create-worktree')
    expect(error).toBe(refusal)
    expect(
      launchFailureWithoutEffectsCode(error, 'create-worktree', trackTerminalSpawnDispatch())
    ).toBe(null)
  })

  it('keeps an outcome unknown when the refusal came after attach', async () => {
    const { run } = launch(
      new AgentLaunchStructuredSessionRefusedError('agent_session_conflict', 'conflict')
    )
    const error = await run.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AgentLaunchStructuredSessionRefusedError)
    expect(launchFailureWithoutEffectsCode(error, 'existing', trackTerminalSpawnDispatch())).toBe(
      null
    )
  })
})
