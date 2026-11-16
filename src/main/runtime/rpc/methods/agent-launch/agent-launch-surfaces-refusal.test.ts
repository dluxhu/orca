import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: createMock
}))

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'

describe('agent launch chat surface refusal', () => {
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
})
