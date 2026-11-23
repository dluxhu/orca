import { describe, expect, it } from 'vitest'
import { AgentLaunchStructuredSessionRefusedError } from '../../../agent-launch/agent-launch-surface-factories'
import { passthroughMessage } from './passthrough-message'

const UNKNOWN = 'agent_session_operation_unknown'

describe('the text of an unknown launch outcome', () => {
  it('keeps host text such as a path out of the envelope', () => {
    const cause = Object.assign(new Error('ENOENT: no such file or directory, open /Users/x/y'), {
      code: 'ENOENT'
    })
    expect(passthroughMessage(new Error(UNKNOWN, { cause }), UNKNOWN)).toBe(UNKNOWN)
  })

  it('names only the code of a chat create refusal', () => {
    const cause = new AgentLaunchStructuredSessionRefusedError(
      'agent_session_conflict',
      'host words at /Users/x'
    )
    const text = passthroughMessage(new Error(UNKNOWN, { cause }), UNKNOWN)
    expect(text).toContain('agent_session_conflict')
    expect(text).not.toContain('/Users/x')
  })
})
