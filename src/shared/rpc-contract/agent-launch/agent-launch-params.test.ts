// Unknown telemetry labels from newer clients must not block launches on older hosts.

import { describe, expect, it } from 'vitest'
import { AgentLaunch } from './agent-launch-params'

const BASE = { agent: 'claude', target: { kind: 'existing', worktree: 'wt-1' } }

describe('agent.launch params', () => {
  it('reads placement and presentation, and never refuses a launch over either', () => {
    const parsed = AgentLaunch.parse({
      ...BASE,
      placement: { groupId: 'group-1', afterTabId: 'tab-1', splitDirection: 'right' },
      presentation: 'background'
    })
    expect(parsed.placement).toEqual({ groupId: 'group-1', afterTabId: 'tab-1' })
    expect(parsed.presentation).toBe('background')
    expect(AgentLaunch.parse({ ...BASE, presentation: 'peek' }).presentation).toBeUndefined()
  })

  it('drops a placement id or a presentation that is not a string instead of refusing the launch', () => {
    expect(
      AgentLaunch.parse({ ...BASE, placement: { groupId: 7, afterTabId: 'tab-1' } }).placement
    ).toEqual({
      afterTabId: 'tab-1'
    })
    expect(AgentLaunch.parse({ ...BASE, placement: 'group-1' }).placement).toBeUndefined()
    expect(AgentLaunch.safeParse({ ...BASE, presentation: 5 })).toMatchObject({
      success: true,
      data: { presentation: undefined }
    })
  })
})

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
