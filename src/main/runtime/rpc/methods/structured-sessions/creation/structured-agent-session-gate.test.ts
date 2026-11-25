import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../../../shared/agent-session/capabilities/agent-session-runtime-capabilities'
import {
  AGENT_SESSION_CLI_READ_SEND_CLIENT_CAPABILITY,
  AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY
} from '../../../../../../shared/agent-session/capabilities/structured-agent-session-surface-capabilities'
import { setStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { HOST_TEST_SESSION as SESSION } from '../../../../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import {
  createRestTestRig,
  foundRestTestChat,
  restTestSend
} from '../../../../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'
import type { RestTestRig } from '../../../../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import type { RpcResponse } from '../../../core'
import { RpcDispatcher } from '../../../dispatcher'
import { STRUCTURED_AGENT_SESSION_METHODS } from '../structured-agent-session'
import { clientReadsAndSendsOnly } from './structured-agent-session-gate'

const PAIRED_CLI = {
  clientId: 'device-1',
  clientKind: 'runtime' as const,
  clientCapabilities: [
    AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY,
    AGENT_SESSION_CLI_READ_SEND_CLIENT_CAPABILITY
  ],
  connectionId: 'connection-1'
}

describe('clientReadsAndSendsOnly', () => {
  it('admits a paired client that asked for CLI read and send', () => {
    expect(clientReadsAndSendsOnly(PAIRED_CLI)).toBe(true)
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

describe('agentSession methods for a CLI read-send client', () => {
  let rig: RestTestRig
  let dispatcher: RpcDispatcher
  let requests = 0

  async function call(
    method: string,
    params: unknown,
    client: typeof PAIRED_CLI = PAIRED_CLI
  ): Promise<RpcResponse> {
    const replies: RpcResponse[] = []
    requests += 1
    await dispatcher.dispatchStreaming(
      { id: `request-${requests}`, authToken: 'token', method, params },
      (raw) => replies.push(JSON.parse(raw)),
      client
    )
    return replies[0]!
  }

  beforeEach(async () => {
    rig = await createRestTestRig({ idleSweep: { intervalMs: 3_600_000 } })
    setStructuredAgentSessionHost(rig.host)
    dispatcher = new RpcDispatcher({
      runtime: new OrcaRuntimeService(),
      methods: STRUCTURED_AGENT_SESSION_METHODS
    })
    await foundRestTestChat(rig)
  })

  afterEach(async () => {
    setStructuredAgentSessionHost(null)
    await rig.dispose()
  })

  it('reaches the host for history and send', async () => {
    const history = await call('agentSession.history', {
      sessionId: SESSION,
      direction: 'tail',
      limit: 1
    })
    expect(history).toMatchObject({ ok: true, result: { ok: true, page: { sessionId: SESSION } } })
    const fence = rig.store.getRecord(SESSION)!.lease.runtimeFence
    const sent = await call('agentSession.send', restTestSend('from the paired CLI', fence))
    expect(sent).toMatchObject({ ok: true, result: { ok: true } })
  })

  it('refuses every other agentSession method', async () => {
    const subscribe = await call('agentSession.subscribe', { sessionId: SESSION })
    expect(JSON.stringify(subscribe)).toContain('structured_agent_session_unsupported')
    expect(subscribe.ok).toBe(false)
  })

  it('refuses history to a paired client without the capability', async () => {
    const history = await call(
      'agentSession.history',
      { sessionId: SESSION, direction: 'tail', limit: 1 },
      { ...PAIRED_CLI, clientCapabilities: [AGENT_SESSION_RENAME_ONLY_CLIENT_CAPABILITY] }
    )
    expect(JSON.stringify(history)).toContain('structured_agent_session_unsupported')
  })
})
