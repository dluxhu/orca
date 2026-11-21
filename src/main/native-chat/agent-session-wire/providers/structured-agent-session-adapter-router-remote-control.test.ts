import { describe, expect, it, vi } from 'vitest'
import { StructuredAgentSessionAdapterRouter } from './structured-agent-session-adapter-router'
import type { StructuredAgentRegistry } from './structured-agent-registry'

describe('adapter router Remote Control at open', () => {
  it('reaches the agent adapter before the chat has a live owner', () => {
    const turnOn = vi.fn(() => true)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the router reads only registration(agent).adapter here.
    const agents = {
      registration: (agent: string) =>
        agent === 'claude' ? { adapter: { turnOnRemoteControlAtOpen: turnOn } } : null
    } as unknown as StructuredAgentRegistry
    const router = new StructuredAgentSessionAdapterRouter(agents, async () => {})

    expect(router.turnOnRemoteControlAtOpen({ sessionId: 'claude_1', agent: 'claude' })).toBe(true)
    expect(turnOn).toHaveBeenCalledWith({ sessionId: 'claude_1', agent: 'claude' })
    expect(router.turnOnRemoteControlAtOpen({ sessionId: 'codex_1', agent: 'codex' })).toBe(false)
  })
})
