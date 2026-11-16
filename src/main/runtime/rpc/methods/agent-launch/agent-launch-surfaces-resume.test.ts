import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: createMock
}))

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'

describe('agent launch chat surface', () => {
  it('passes the resumed provider session to the chat create', async () => {
    createMock.mockResolvedValue({ ok: true, value: { sessionId: 'claude_1', fence: 1 } })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed create never reaches the runtime.
    const context = { runtime: {}, clientKind: 'runtime' } as unknown as RpcContext
    await agentLaunchSurfaceFactory(context).createStructuredSession({
      worktreeId: 'wt-1',
      agent: 'claude',
      resumeFrom: { providerSessionId: 'claude-session-1' }
    })
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      resumeFrom: { providerSessionId: 'claude-session-1' }
    })
  })
})
