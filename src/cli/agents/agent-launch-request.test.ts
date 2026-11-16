import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_LAUNCH_RESUME_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITIES
} from '../../shared/agent-launch/contracts/agent-launch-runtime-capability'
import { RuntimeClient } from '../runtime/client'
import { callAgentLaunch, readCliAgentLaunch } from './agent-launch-request'

const read = (flags: Record<string, string>) =>
  readCliAgentLaunch(new Map(Object.entries(flags)), 'claude', { createsWorktree: false })

describe('orca agent launch --resume', () => {
  it('sends the provider session id with a chat launch', () => {
    expect(read({ surface: 'chat', resume: 'claude-1' })).toMatchObject({
      surface: 'chat',
      resumeFrom: { providerSessionId: 'claude-1' }
    })
  })

  it('refuses --resume without --surface chat or with --prompt', () => {
    const cases: Record<string, string>[] = [
      { resume: 'claude-1' },
      { resume: 'claude-1', surface: 'terminal' },
      { resume: 'claude-1', surface: 'chat', prompt: 'hi' }
    ]
    for (const flags of cases) {
      expect(() => read(flags), JSON.stringify(flags)).toThrow(/--resume/)
    }
  })

  it('refuses a host that would drop the resume and start a fresh chat', async () => {
    const client = new RuntimeClient('/tmp/orca-launch-test', 60_000, null, null)
    const call = vi.spyOn(client, 'call')
    await expect(
      callAgentLaunch(
        client,
        read({ surface: 'chat', resume: 'claude-1' }),
        { target: { kind: 'existing', worktree: 'id:wt' } },
        AGENT_LAUNCH_RUNTIME_CAPABILITIES.filter(
          (capability) => capability !== AGENT_LAUNCH_RESUME_RUNTIME_CAPABILITY
        )
      )
    ).rejects.toThrow(/resume/)
    expect(call).not.toHaveBeenCalled()
  })
})
