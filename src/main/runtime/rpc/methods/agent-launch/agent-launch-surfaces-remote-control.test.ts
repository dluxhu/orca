import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'
import { AgentLaunchSurfaceUnavailableError } from '../../../../agent-launch/agent-launch-surface-refusal'

const { createMock, turnOnMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  turnOnMock: vi.fn()
}))

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: createMock
}))

vi.mock(
  '../../../../native-chat/agent-session-wire/host/structured-agent-session-registry',
  () => ({
    getStructuredAgentSessionHost: () => ({
      deps: { adapter: { turnOnRemoteControlAtOpen: turnOnMock } }
    })
  })
)

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'

function factory() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed host and create read nothing else from the runtime.
  const context = {
    runtime: { ensureStructuredAgentSessionHost: async () => {} },
    clientKind: 'runtime'
  } as unknown as RpcContext
  return agentLaunchSurfaceFactory(context)
}

describe('agent launch chat with Remote Control', () => {
  it('records Remote Control for the new chat before the create opens it', async () => {
    const order: string[] = []
    turnOnMock.mockImplementation(() => {
      order.push('turnOn')
      return true
    })
    createMock.mockImplementation(async (args: { envelope: { sessionId: string } }) => {
      order.push('create')
      return { ok: true, value: { sessionId: args.envelope.sessionId, fence: 1 } }
    })
    const created = await factory().createStructuredSession({
      worktreeId: 'wt-1',
      agent: 'claude',
      remoteControl: true
    })
    expect(order).toEqual(['turnOn', 'create'])
    expect(turnOnMock).toHaveBeenCalledWith({ sessionId: created.sessionId, agent: 'claude' })
  })

  it('forgets the Remote Control choice when the create is refused', async () => {
    turnOnMock.mockReset().mockReturnValue(true)
    createMock.mockReset().mockResolvedValue({
      ok: false,
      refusal: { code: 'agent_session_identity_required', message: 'no transcript' },
      beforeCommit: true
    })
    await factory()
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude', remoteControl: true })
      .catch(() => {})
    const [[recorded], [forgotten]] = turnOnMock.mock.calls
    expect(forgotten).toEqual({ ...recorded, forget: true })
  })

  it('forgets the choice when attach refused with the attempt proof', async () => {
    turnOnMock.mockReset().mockReturnValue(true)
    createMock.mockReset().mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_identity_required',
        message: 'This conversation belongs to another directory.',
        details: { reason: 'transcriptUnreadable' },
        createAttemptRefusedBeforeCommit: true
      }
    })
    await factory()
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude', remoteControl: true })
      .catch(() => {})
    const [[recorded], [forgotten]] = turnOnMock.mock.calls
    expect(forgotten).toEqual({ ...recorded, forget: true })
  })

  it('keeps the Remote Control choice when the create outcome is unknown', async () => {
    turnOnMock.mockReset().mockReturnValue(true)
    createMock.mockReset().mockResolvedValue({
      ok: false,
      refusal: {
        code: 'agent_session_operation_unknown',
        message: 'The chat may have been created'
      }
    })
    await factory()
      .createStructuredSession({ worktreeId: 'wt-1', agent: 'claude', remoteControl: true })
      .catch(() => {})
    expect(turnOnMock.mock.calls).toHaveLength(1)
  })

  it('refuses before the create when the agent has no Remote Control', async () => {
    turnOnMock.mockReset().mockReturnValue(false)
    createMock.mockReset()
    await expect(
      factory().createStructuredSession({ worktreeId: 'wt-1', agent: 'codex', remoteControl: true })
    ).rejects.toBeInstanceOf(AgentLaunchSurfaceUnavailableError)
    expect(createMock).not.toHaveBeenCalled()
  })
})
