import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'
import { AgentLaunchStructuredSessionRefusedError } from '../../../../agent-launch/agent-launch-surface-factories'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'

const { createMock, host } = vi.hoisted(() => ({
  createMock: vi.fn(),
  host: {
    sessionAgent: vi.fn((_sessionId: string): string | null => 'claude'),
    revealSession: vi.fn(async (sessionId: string) => ({
      sessionId,
      workspaceId: 'wt-1',
      agent: 'claude',
      readable: true
    })),
    deps: {
      adapter: { turnOnRemoteControlAtOpen: vi.fn(() => true) },
      store: { getRecord: () => ({ lease: { runtimeFence: 23 } }) }
    }
  }
}))

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: createMock
}))

vi.mock(
  '../../../../native-chat/agent-session-wire/host/structured-agent-session-registry',
  () => ({ getStructuredAgentSessionHost: () => host })
)

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'

function factory(presentation?: 'background') {
  const publishStructuredAgentSessionTab = vi.fn(async () => {})
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed host and create read nothing else from the runtime.
  const context = {
    runtime: { ensureStructuredAgentSessionHost: async () => {}, publishStructuredAgentSessionTab },
    clientKind: 'runtime'
  } as unknown as RpcContext
  const surfaces = agentLaunchSurfaceFactory(context, undefined, undefined, false, undefined, {
    early: null,
    presentation
  })
  return { surfaces, publishStructuredAgentSessionTab }
}

/** The pre-commit refusal of a resume whose conversation the chat `claude_old` holds. */
function heldElsewhere(code: string, workspaceId = 'wt-1', beforeCommit = true) {
  createMock.mockReset().mockResolvedValue({
    ok: false,
    refusal: {
      code,
      message: 'Orca cannot open a structured agent chat for this workspace.',
      details: {
        reason: 'conversationHeldElsewhere',
        owner: { sessionId: 'claude_old', workspaceId }
      }
    },
    beforeCommit
  })
  host.revealSession.mockClear()
  host.sessionAgent.mockClear().mockReturnValue('claude')
  host.deps.adapter.turnOnRemoteControlAtOpen.mockClear()
}

const RESUME = {
  worktreeId: 'wt-1',
  agent: 'claude',
  resumeFrom: { providerSessionId: 'claude-session-1' }
} as const

describe('agent launch chat surface', () => {
  it('passes the resumed provider session to the chat create', async () => {
    createMock.mockResolvedValue({ ok: true, value: { sessionId: 'claude_1', fence: 1 } })
    await factory().surfaces.createStructuredSession(RESUME)
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      resumeFrom: { providerSessionId: 'claude-session-1' }
    })
  })

  it('opens the chat that holds the conversation when no live owner holds it', async () => {
    heldElsewhere('agent_session_ownership_unknown')
    const { surfaces, publishStructuredAgentSessionTab } = factory()
    const surface = await surfaces.createStructuredSession({ ...RESUME, remoteControl: true })
    expect(surface).toEqual({
      sessionId: 'claude_old',
      handle: structuredAgentSessionTabId('claude_old'),
      fence: 23
    })
    expect(publishStructuredAgentSessionTab).toHaveBeenCalledWith({
      workspaceId: 'wt-1',
      sessionId: 'claude_old',
      agent: 'claude',
      activate: true
    })
    expect(host.deps.adapter.turnOnRemoteControlAtOpen).toHaveBeenCalledWith({
      sessionId: 'claude_old',
      agent: 'claude'
    })
  })

  it('keeps the refusal when a chat with a live owner holds the conversation', async () => {
    heldElsewhere('agent_session_conflict')
    const error = await factory()
      .surfaces.createStructuredSession(RESUME)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AgentLaunchStructuredSessionRefusedError)
    expect(error).toMatchObject({ code: 'agent_session_conflict' })
    expect(host.revealSession).not.toHaveBeenCalled()
  })

  it('keeps the refusal when the holding chat is in another workspace', async () => {
    heldElsewhere('agent_session_ownership_unknown', 'wt-2')
    const error = await factory()
      .surfaces.createStructuredSession(RESUME)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_ownership_unknown' })
    expect(host.revealSession).not.toHaveBeenCalled()
  })

  it('keeps the refusal when a chat of another agent holds the conversation', async () => {
    heldElsewhere('agent_session_ownership_unknown')
    host.sessionAgent.mockReturnValue('codex')
    const error = await factory()
      .surfaces.createStructuredSession(RESUME)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_ownership_unknown' })
    expect(host.revealSession).not.toHaveBeenCalled()
  })

  it('keeps the refusal when the create cannot prove that it changed nothing', async () => {
    heldElsewhere('agent_session_ownership_unknown', 'wt-1', false)
    const error = await factory()
      .surfaces.createStructuredSession(RESUME)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_ownership_unknown' })
    expect(host.revealSession).not.toHaveBeenCalled()
  })

  it('opens the holding chat without focus for a background launch', async () => {
    heldElsewhere('agent_session_ownership_unknown')
    const { surfaces, publishStructuredAgentSessionTab } = factory('background')
    await surfaces.createStructuredSession(RESUME)
    expect(publishStructuredAgentSessionTab).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'claude_old', activate: false })
    )
  })

  it('keeps the refusal for a create that resumes nothing', async () => {
    heldElsewhere('agent_session_ownership_unknown')
    const { resumeFrom: _resume, ...fresh } = RESUME
    const error = await factory()
      .surfaces.createStructuredSession(fresh)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'agent_session_ownership_unknown' })
    expect(host.revealSession).not.toHaveBeenCalled()
  })
})
