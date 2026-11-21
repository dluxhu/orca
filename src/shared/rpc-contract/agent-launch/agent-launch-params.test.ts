import { describe, expect, it } from 'vitest'
import { AgentLaunch } from './agent-launch-params'

const BASE = { agent: 'claude', target: { kind: 'existing', worktree: 'wt-1' } }

describe('agent.launch resumeFrom', () => {
  const RESUME = { ...BASE, surface: 'chat', resumeFrom: { providerSessionId: 'claude-1' } }

  it('accepts a chat resume on an existing workspace', () => {
    expect(AgentLaunch.parse(RESUME).resumeFrom).toEqual({ providerSessionId: 'claude-1' })
  })

  it('refuses a resume that could start a fresh conversation or run elsewhere', () => {
    for (const params of [
      { ...RESUME, surface: undefined },
      { ...RESUME, surface: 'terminal' },
      { ...RESUME, prompt: { text: 'hi', delivery: 'submit' } },
      { ...RESUME, target: { kind: 'create-worktree', create: { repo: 'r' } } },
      { ...RESUME, resumeFrom: { providerSessionId: '' } }
    ]) {
      expect(AgentLaunch.safeParse(params).success, JSON.stringify(params)).toBe(false)
    }
  })
})

describe('agent.launch remoteControl', () => {
  const ON = { ...BASE, surface: 'chat', remoteControl: true }

  it('accepts Remote Control on a chat launch', () => {
    expect(AgentLaunch.parse(ON).remoteControl).toBe(true)
  })

  it('refuses Remote Control off a chat or on a caller-named session', () => {
    for (const params of [
      { ...ON, surface: undefined },
      { ...ON, surface: 'terminal' },
      { ...ON, sessionId: 'claude_1d39fd0e_11b0_41d0_9c4a_e3f7da9ac2fd' },
      { ...ON, remoteControl: false }
    ]) {
      expect(AgentLaunch.safeParse(params).success, JSON.stringify(params)).toBe(false)
    }
  })
})
