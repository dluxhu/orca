import { closeTestJournalHostDatabases } from '../../../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
/** A resume that the commit refuses stays unknown over agent.launchReplay and names the refusal code. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecordStore } from '../../../agent-session/records/agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../../agent-session/records/agent-session-record-store-test-harness'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { RpcDispatcher } from '../../dispatcher'
import { RuntimeRpcFailureError } from '../../../../../cli/runtime/types'
import { withCliAgentLaunchRecovery } from '../../../../../cli/agents/agent-launch-recovery'
import type { RuntimeRpcFailure } from '../../../../../shared/runtime-rpc-envelope'
import {
  methodNamed,
  runtimeStub,
  setAgentLaunchRecordStore,
  STRUCTURED_PREFERENCE
} from './agent-launch.test-fixture'

vi.mock('../structured-sessions/creation/structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: async () => ({
    ok: false,
    refusal: {
      code: 'structured_agent_session_unsupported',
      message: 'Orca cannot open this conversation as a chat.'
    }
  })
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const AGENT_LAUNCH_REPLAY = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launchReplay')

describe('a resume that the commit refuses', () => {
  const OPERATION_ID = `${Date.now()}-000000000000000000000000000000ef`
  let directory: string
  let store: AgentSessionRecordStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-agent-launch-resume-unknown-'))
    store = await openTestAgentSessionRecordStore(directory)
    setAgentLaunchRecordStore(store)
  })

  afterEach(async () => {
    setAgentLaunchRecordStore(null)
    await closeTestJournalHostDatabases()
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps the unknown code, and the host and CLI texts name the refusal code', async () => {
    const runtime = runtimeStub({
      settings: STRUCTURED_PREFERENCE,
      createSupport: { supported: true }
    })
    const dispatcher = new RpcDispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture implements every runtime method reached by agent.launch and dispatcher metadata.
      runtime: { ...runtime, getRuntimeId: () => 'runtime-1' } as unknown as OrcaRuntimeService,
      methods: AGENT_LAUNCH_METHODS
    })
    const response = await dispatcher.dispatch({
      id: 'request-1',
      authToken: 'token',
      method: 'agent.launchReplay',
      params: AGENT_LAUNCH_REPLAY.params.parse({
        agent: 'claude',
        target: { kind: 'existing', worktree: 'id:wt-7' },
        surface: 'chat',
        resumeFrom: { providerSessionId: 'claude-session-1' },
        operationId: OPERATION_ID
      })
    })

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'agent_session_operation_unknown' }
    })
    expect(JSON.stringify(response)).toContain('structured_agent_session_unsupported')
    // The CLI keeps the unknown outcome and prints the host's text as its cause.
    const cli = await withCliAgentLaunchRecovery(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatch answered ok: false, checked above.
      Promise.reject(new RuntimeRpcFailureError(response as RuntimeRpcFailure)),
      { operationId: OPERATION_ID, params: {} }
    ).catch((caught: unknown) => caught)
    expect(cli).toMatchObject({
      code: 'agent_session_operation_unknown',
      data: { cause: expect.stringContaining('structured_agent_session_unsupported') }
    })
    expect(
      store.listOperationRows().find((row) => row.operationId === OPERATION_ID)?.outcome?.status
    ).toBe('unknown')
  })
})
