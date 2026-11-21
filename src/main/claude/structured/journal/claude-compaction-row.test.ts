import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AgentJournalItemBody } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentJournalItemIdentity } from '../../../../shared/agent-session/journal/agent-session-journal-identity'
import type { AgentJournalTurnScope } from '../../../../shared/agent-session/journal/agent-session-journal-turn-scope'
import type { StructuredAgentSessionEventSink } from '../../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import type { StructuredAgentSessionRevisionJournal } from '../../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-journal-views'
import {
  CAPTURED_COMPACT_SESSION_ID,
  CAPTURED_COMPACT_SUCCEEDS,
  type CapturedCompactEvent
} from '../../fixtures/claude-captured-compact-frames.test-fixture'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

const COMMAND_IDENTITY: AgentJournalItemIdentity = {
  provider: 'orca',
  clientMessageId: 'command-turn:cmd-1'
}
const COMMAND_KEY = agentJournalItemKey(COMMAND_IDENTITY)
const NOW = 1_800_000_000_000

const RUNNING = {
  kind: 'turn' as const,
  turnId: 'compact:cmd-1',
  state: 'running' as const,
  userItemId: 'orca:submission:cmd-1',
  requestedAt: 900,
  startedAt: 1_000
}

// Usage limits expire by the system clock; pin it so the quota reset stays an hour ahead.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

type Row = { key: string; body: AgentJournalItemBody; turnScope?: AgentJournalTurnScope }

function harness() {
  const rows = new Map<string, Row>([[COMMAND_KEY, { key: COMMAND_KEY, body: RUNNING }]])
  const write = (
    identity: AgentJournalItemIdentity,
    body: AgentJournalItemBody,
    turnScope?: AgentJournalTurnScope
  ) => {
    const row = { key: agentJournalItemKey(identity), body, ...(turnScope ? { turnScope } : {}) }
    rows.set(row.key, row)
  }
  const journal: StructuredAgentSessionRevisionJournal = {
    item: () => null,
    epoch: 'epoch-1',
    itemBody: (itemId) => rows.get(itemId)?.body ?? null,
    visitItems: (visit) => {
      let sequence = 0
      for (const row of rows.values()) {
        visit(row.key, sequence++, row.body)
      }
    }
  }
  const revise: NonNullable<StructuredAgentSessionEventSink['tryReviseResolvedItem']> = (
    _bytes,
    resolve,
    options
  ) => {
    const resolved = resolve(journal)
    if (resolved) {
      write(resolved.identity, resolved.body, options.turnScope)
    }
    return { accepted: true }
  }
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body, options) => write(identity, body, options.turnScope),
    appendTombstone: vi.fn(),
    publish: vi.fn(),
    tryReviseResolvedItem: revise,
    tryReviseResolvedItemAndPublish: revise
  }
  const translator = createClaudeJournalTranslator({ sink, fallbackIdPrefix: 'test' })
  const frame = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    translator.handle({
      type: 'message',
      sessionId: 'orca-session',
      message: { session_id: CAPTURED_COMPACT_SESSION_ID, ...message },
      observedAt: 5_000,
      ...extra
    })
  const begin = (sentUuid: string) =>
    translator.beginCommand({
      clientMessageId: 'cmd-1',
      turnId: RUNNING.turnId,
      identity: COMMAND_IDENTITY,
      resultIdentity: { provider: 'orca', clientMessageId: 'command-result:cmd-1' },
      running: RUNNING,
      providerSessionId: CAPTURED_COMPACT_SESSION_ID,
      sentUuid
    })
  const replay = (events: readonly CapturedCompactEvent[]) => {
    for (const event of events) {
      if ('sent' in event) {
        if (event.sent.text === '/compact') {
          begin(event.sent.uuid)
        }
      } else if ('interrupt' in event) {
        translator.commandInterruptRequested(RUNNING.turnId)
      } else {
        frame(event.frame)
      }
    }
  }
  const drawn = () =>
    [...rows.values()].filter((row) => row.key !== COMMAND_KEY && row.body.kind !== 'turn')
  return { frame, replay, drawn }
}

describe('a Claude compact boundary', () => {
  const compactions = (rows: Row[]) =>
    rows.filter((row) => row.body.kind === 'status' && row.body.presentation === 'compaction')

  it('writes one divider when Claude compacts on its own', () => {
    const { frame, drawn } = harness()
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 167_000 },
      uuid: 'auto-boundary'
    }
    frame(boundary)
    frame(boundary)
    expect(compactions(drawn()).map((row) => row.body)).toEqual([
      { kind: 'status', text: 'Context compacted automatically', presentation: 'compaction' }
    ])
  })

  it('writes no divider for a subagent boundary', () => {
    const { frame, drawn } = harness()
    frame({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 167_000 },
      parent_tool_use_id: 'task-1',
      uuid: 'child-boundary'
    })
    expect(compactions(drawn())).toEqual([])
  })

  it('keeps one divider for a /compact command', () => {
    const { replay, drawn } = harness()
    replay(CAPTURED_COMPACT_SUCCEEDS)
    expect(compactions(drawn()).map((row) => row.body)).toEqual([
      { kind: 'status', text: 'Context compacted', presentation: 'compaction' }
    ])
  })
})
