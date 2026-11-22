import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: createMock
}))

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'
import { launchRefusalWithoutEffects } from '../../../../agent-launch/agent-launch-create-refusal'
import { mapRuntimeError } from '../../responses/rpc-response'

describe('agent launch chat surface refusal', () => {
  it('marks an attach refusal that proves the create attempt changed nothing', async () => {
    createMock.mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_identity_required',
        message: 'This conversation belongs to another directory.',
        details: { reason: 'transcriptUnreadable' },
        createAttemptRefusedBeforeCommit: true
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed create never reaches the runtime.
    const context = { runtime: {}, clientKind: 'runtime' } as unknown as RpcContext
    const error = await agentLaunchSurfaceFactory(context)
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_identity_required', beforeCommit: true })
  })

  it('does not mark an attach refusal without that proof', async () => {
    createMock.mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_identity_required',
        message: 'no transcript',
        details: { reason: 'transcriptUnreadable' }
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed create never reaches the runtime.
    const context = { runtime: {}, clientKind: 'runtime' } as unknown as RpcContext
    const error = await agentLaunchSurfaceFactory(context)
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ beforeCommit: false })
  })

  it('marks a refusal from before attach', async () => {
    createMock.mockResolvedValue({
      ok: false,
      refusal: { code: 'agent_session_identity_required', message: 'no transcript' },
      beforeCommit: true
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed create never reaches the runtime.
    const context = { runtime: {}, clientKind: 'runtime' } as unknown as RpcContext
    const error = await agentLaunchSurfaceFactory(context)
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_identity_required', beforeCommit: true })
  })

  it('names the reason and the chat that holds the conversation in the launch answer', async () => {
    const owner = { sessionId: 'claude_old', workspaceId: 'wt-1' }
    createMock.mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_ownership_unknown',
        message: 'Orca cannot open a structured agent chat for this workspace.',
        details: { reason: 'conversationHeldElsewhere', owner }
      },
      beforeCommit: true
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed create never reaches the runtime.
    const context = { runtime: {}, clientKind: 'runtime' } as unknown as RpcContext
    const refused = await agentLaunchSurfaceFactory(context)
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude' })
      .catch((caught: unknown) => caught)
    const answer = mapRuntimeError(
      'request-1',
      { runtimeId: 'runtime-1' },
      launchRefusalWithoutEffects(refused, 'existing')
    )
    expect(answer.error).toEqual({
      code: 'agent_launch_surface_unavailable',
      message:
        'Orca cannot open a structured agent chat for this workspace. (agent_session_ownership_unknown, conversationHeldElsewhere, held by chat claude_old)',
      data: {
        refusal: {
          code: 'agent_session_ownership_unknown',
          details: { reason: 'conversationHeldElsewhere', owner }
        }
      }
    })
  })
})
