import { describe, expect, it, vi } from 'vitest'

const { profileRuntime } = vi.hoisted(() => ({ profileRuntime: vi.fn(() => true) }))
vi.mock('../../app-profiles/app-profile', () => ({ isAppProfileRuntime: profileRuntime }))

import { installManagedAgentHooks, removeManagedAgentHooks } from './managed-agent-hook-controls'

describe('managed agent hooks in an app profile', () => {
  it('installs and removes nothing: the agent configs are shared until isolation lands', async () => {
    const installed = await installManagedAgentHooks(null, { agents: ['claude', 'grok'] })
    expect(installed.map((status) => [status.agent, status.state])).toEqual([
      ['claude', 'skipped'],
      ['grok', 'skipped']
    ])
    const removed = await removeManagedAgentHooks({ agents: ['claude'] })
    expect(removed).toEqual([expect.objectContaining({ agent: 'claude', state: 'skipped' })])
  })
})
