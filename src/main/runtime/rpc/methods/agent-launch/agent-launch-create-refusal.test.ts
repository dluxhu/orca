import { describe, expect, it, vi } from 'vitest'
import { agentSessionRefusalError } from '../../../../../shared/agent-session/failures/agent-session-wire-refusals'
import { createStructuredAgentSessionForWorktree } from '../structured-sessions/creation/structured-agent-session-create'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { StructuredAgentSessionHost } from '../../../../native-chat/agent-session-wire/host/structured-agent-session-host'

describe('chat create refused before attach', () => {
  it('says the refusal came before commit', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: prepare refuses at the first runtime call; nothing else is read.
    const runtime = {
      resolveStructuredAgentSessionCreateIntent: async () => {
        throw agentSessionRefusalError('agent_session_identity_required', {
          reason: 'transcriptNotFound'
        })
      }
    } as unknown as OrcaRuntimeService
    const ensureHost = vi.fn(async (): Promise<StructuredAgentSessionHost> => {
      throw new Error('not reached')
    })
    const created = await createStructuredAgentSessionForWorktree({
      runtime,
      ensureHost,
      caller: { callerKey: 'cli' },
      envelope: {
        sessionId: 'claude_1',
        clientOperationId: 'op-1',
        expectedRuntimeFence: null,
        payloadFingerprint: ''
      },
      worktree: 'id:wt-1',
      agent: 'claude',
      activate: false
    })
    expect(created).toMatchObject({ ok: false, beforeCommit: true })
  })
})
