import type { AgentJournalStatusItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentJournalTurnScope } from '../../../../shared/agent-session/journal/agent-session-journal-turn-scope'
import { NATIVE_CHAT_NOTICE_COPY } from '../../../../shared/native-chat/transcript/notices/native-chat-notice'
import type { StructuredAgentSessionEventSink } from '../../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import { isRootClaudeFrame } from '../turns/claude-turn-opening'
import { claudeRecord, claudeText } from './claude-structured-item-translation'

/** The divider row for Claude's compact boundary. Stream frames use `compact_metadata`; transcript records use `compactMetadata`. */
export function claudeCompactionRow(frame: Record<string, unknown>): AgentJournalStatusItem | null {
  if (frame.type !== 'system' || frame.subtype !== 'compact_boundary') {
    return null
  }
  const metadata = claudeRecord(frame.compact_metadata) ?? claudeRecord(frame.compactMetadata)
  return {
    kind: 'status',
    text:
      metadata?.trigger === 'auto'
        ? NATIVE_CHAT_NOTICE_COPY.compactionAutomatic
        : NATIVE_CHAT_NOTICE_COPY.compaction,
    presentation: 'compaction'
  }
}

/** Write the divider for a compact boundary of the main conversation. Return false for any other frame. */
export function journalClaudeCompaction(
  sink: StructuredAgentSessionEventSink,
  frame: Record<string, unknown>,
  turnScope: AgentJournalTurnScope,
  commandOpen: boolean
): boolean {
  // A /compact command writes its own row when its result arrives.
  const row = !commandOpen && isRootClaudeFrame(frame) ? claudeCompactionRow(frame) : null
  const uuid = claudeText(frame.uuid)
  if (!row || !uuid) {
    return false
  }
  // The frame's uuid keys the row, so a replayed frame revises it.
  sink.appendItem({ provider: 'orca', clientMessageId: `claude-compaction:${uuid}` }, row, {
    turnScope
  })
  sink.publish()
  return true
}
