// Orca @dLux patch "Chat CLI": see PATCHES.md.
import { describe, expect, it } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../../../shared/agent-session/agent-session-runtime-capabilities'
import {
  AGENT_SESSION_CLI_READ_SEND_CLIENT_CAPABILITY,
  AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY
} from '../../../../../../shared/agent-session/structured-agent-session-surface-capabilities'
import { clientReadsAndSendsOnly } from './structured-agent-session-gate'

describe('clientReadsAndSendsOnly', () => {
  it('admits a paired client that asked for CLI read and send', () => {
    expect(
      clientReadsAndSendsOnly({
        clientKind: 'runtime',
        clientCapabilities: [
          AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY,
          AGENT_SESSION_CLI_READ_SEND_CLIENT_CAPABILITY
        ]
      })
    ).toBe(true)
  })

  it('leaves every other client on the structured gate', () => {
    expect(
      clientReadsAndSendsOnly({
        clientKind: 'runtime',
        clientCapabilities: [AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY]
      })
    ).toBe(false)
    expect(
      clientReadsAndSendsOnly({
        clientKind: 'mobile',
        clientCapabilities: [
          STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
          AGENT_SESSION_CLI_READ_SEND_CLIENT_CAPABILITY
        ]
      })
    ).toBe(false)
    expect(clientReadsAndSendsOnly({})).toBe(false)
  })
})
