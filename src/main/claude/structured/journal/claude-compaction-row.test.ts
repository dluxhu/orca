import { describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AgentJournalItemBody } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import {
  CAPTURED_COMPACT_SESSION_ID,
  CAPTURED_COMPACT_SUCCEEDS
} from '../../fixtures/claude-captured-compact-frames.test-fixture'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

function harness() {
  const rows = new Map<string, AgentJournalItemBody>()
  const translator = createClaudeJournalTranslator({
    sink: {
      appendItem: (identity, body) => rows.set(agentJournalItemKey(identity), body),
      appendTombstone: () => {},
      publish: () => {}
    }
  })
  const frame = (message: Record<string, unknown>) =>
    translator.handle({
      type: 'message',
      sessionId: 'orca-session',
      message: { session_id: CAPTURED_COMPACT_SESSION_ID, ...message },
      observedAt: 5_000
    })
  const compactions = () =>
    [...rows.values()].filter(
      (body) => body.kind === 'status' && body.presentation === 'compaction'
    )
  return { translator, frame, compactions }
}

describe('a Claude compact boundary', () => {
  it('writes one divider when Claude compacts on its own', () => {
    const { frame, compactions } = harness()
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 167_000 },
      uuid: 'auto-boundary'
    }
    frame(boundary)
    frame(boundary)
    expect(compactions()).toEqual([
      { kind: 'status', text: 'Context compacted automatically', presentation: 'compaction' }
    ])
  })

  it('writes no divider for a subagent boundary', () => {
    const { frame, compactions } = harness()
    frame({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 167_000 },
      parent_tool_use_id: 'task-1',
      uuid: 'child-boundary'
    })
    expect(compactions()).toEqual([])
  })

  it('keeps one divider for a /compact command', () => {
    const { translator, frame, compactions } = harness()
    const running = {
      kind: 'turn' as const,
      turnId: 'compact:cmd-1',
      state: 'running' as const,
      userItemId: 'orca:submission:cmd-1',
      requestedAt: 900,
      startedAt: 1_000
    }
    for (const event of CAPTURED_COMPACT_SUCCEEDS) {
      if ('sent' in event) {
        translator.beginCommand({
          clientMessageId: 'cmd-1',
          turnId: running.turnId,
          identity: { provider: 'orca', clientMessageId: 'command-turn:cmd-1' },
          resultIdentity: { provider: 'orca', clientMessageId: 'command-result:cmd-1' },
          running,
          providerSessionId: CAPTURED_COMPACT_SESSION_ID,
          sentUuid: event.sent.uuid
        })
      } else if ('frame' in event) {
        frame(event.frame)
      }
    }
    expect(compactions()).toEqual([
      { kind: 'status', text: 'Context compacted', presentation: 'compaction' }
    ])
  })
})
