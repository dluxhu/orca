import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_LAUNCH_REMOTE_CONTROL_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RESUME_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITIES
} from '../../shared/agent-launch/contracts/agent-launch-runtime-capability'
import { RuntimeClient } from '../runtime/client'
import { callAgentLaunch, readCliAgentLaunch } from './agent-launch-request'
import { parseArgs } from '../arguments/args'

const read = (flags: Record<string, string | boolean>) =>
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

describe('orca agent launch --remote-control', () => {
  it('asks the host for Remote Control on a chat launch', () => {
    expect(read({ surface: 'chat', 'remote-control': true })).toMatchObject({
      surface: 'chat',
      remoteControl: true
    })
  })

  it('reads --remote-control as a flag without a value', () => {
    const { flags } = parseArgs(
      ['agent', 'launch', '--remote-control', 'claude-1'],
      [['agent', 'launch']]
    )
    expect(flags.get('remote-control')).toBe(true)
  })

  it('refuses --remote-control without --surface chat', () => {
    expect(() => read({ 'remote-control': true })).toThrow(/--remote-control/)
    expect(() => read({ surface: 'terminal', 'remote-control': true })).toThrow(/--remote-control/)
  })

  it('refuses a host that would drop Remote Control', async () => {
    const client = new RuntimeClient('/tmp/orca-launch-test', 60_000, null, null)
    const call = vi.spyOn(client, 'call')
    await expect(
      callAgentLaunch(
        client,
        read({ surface: 'chat', 'remote-control': true }),
        { target: { kind: 'existing', worktree: 'id:wt' } },
        AGENT_LAUNCH_RUNTIME_CAPABILITIES.filter(
          (capability) => capability !== AGENT_LAUNCH_REMOTE_CONTROL_RUNTIME_CAPABILITY
        )
      )
    ).rejects.toThrow(/Remote Control/)
    expect(call).not.toHaveBeenCalled()
  })
})
