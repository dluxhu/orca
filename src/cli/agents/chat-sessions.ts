import { agentSessionPromptQuestions } from '../../shared/agent-session/requests/prompts/agent-session-question-answer'
import { isActionableStructuredAgentSessionPrompt } from '../../shared/agent-session/view/structured-agent-session-live-turn'
import { isRootAgentJournalItem } from '../../shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../shared/agent-session/journal/agent-session-journal-types'
import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../../shared/worktree/catalog/runtime-worktree-contracts'
import { structuredAgentSessionTabId } from '../../shared/agent-session/view/structured-agent-session-projection'
import { RuntimeClientError } from '../runtime/connection/types'

const CHAT_HANDLE_PREFIX = structuredAgentSessionTabId('')

export type ChatSessionEntry = {
  session: string
  worktreeId: string
  worktree: string
  agentType: string | null
  state: RuntimeWorktreeAgentRow['state']
  title: string | null
  lastAssistantMessage: string | null
  updatedAt: number
}

export type ChatTranscriptEntry =
  | { kind: 'message'; role: string; text: string }
  | { kind: 'tool'; name: string; state: string }
  | { kind: 'approval' | 'question'; text: string; pending: boolean }
  | { kind: 'error'; text: string }

/** The session id of a chat, from its id, its tab handle, or a pane key "<handle>:<leaf>". */
export function parseChatSessionSelector(value: string): string {
  const withoutHandle = value.startsWith(CHAT_HANDLE_PREFIX)
    ? value.slice(CHAT_HANDLE_PREFIX.length)
    : value
  const session = withoutHandle.split(':')[0]?.trim() ?? ''
  if (session.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--session needs a chat session id; run `orca chat list` to find one.'
    )
  }
  return session
}

/** Top-level chats only: terminal agents use `orca terminal`, and subagents belong to their parent chat. */
export function listChatSessions(
  worktrees: readonly RuntimeWorktreePsSummary[]
): ChatSessionEntry[] {
  return worktrees.flatMap((worktree) =>
    worktree.agents
      .filter(
        (agent) => agent.parentPaneKey === null && agent.paneKey.startsWith(CHAT_HANDLE_PREFIX)
      )
      .map((agent) => ({
        session: parseChatSessionSelector(agent.paneKey),
        worktreeId: worktree.worktreeId,
        worktree: worktree.displayName,
        agentType: agent.agentType,
        state: agent.state,
        title: agent.conversationName ?? agent.displayName ?? agent.taskTitle,
        lastAssistantMessage: agent.lastAssistantMessage,
        updatedAt: agent.updatedAt
      }))
  )
}

function messageText(item: AgentJournalRenderItem): string {
  if (item.body.kind !== 'message') {
    return ''
  }
  return item.body.blocks
    .map((block) =>
      block.type === 'text' ? block.text : block.type === 'image-ref' ? '[image]' : ''
    )
    .filter((text) => text.length > 0)
    .join('\n')
    .trim()
}

/** Messages, tool calls, errors, approvals and questions. Status frames and turn markers are left out. */
export function chatTranscript(
  items: readonly AgentJournalRenderItem[],
  actionablePromptIds?: readonly string[]
): ChatTranscriptEntry[] {
  // An ended agent's unanswered prompts stay pending in the journal but cannot be answered.
  const waiting = (item: AgentJournalRenderItem, state: string): boolean =>
    state === 'pending' &&
    isActionableStructuredAgentSessionPrompt(item.itemId, actionablePromptIds)
  const entries: ChatTranscriptEntry[] = []
  for (const item of items) {
    // Subagent rows share the journal but are not part of the chat's own turn.
    if (!isRootAgentJournalItem(item)) {
      continue
    }
    const body = item.body
    if (body.kind === 'message') {
      const text = messageText(item)
      // The app folds reasoning away too.
      if (text.length > 0 && body.role !== 'reasoning') {
        entries.push({ kind: 'message', role: body.role, text })
      }
    } else if (body.kind === 'status' && body.tone === 'error') {
      entries.push({ kind: 'error', text: String(body.text) })
    } else if (body.kind === 'tool-call') {
      entries.push({ kind: 'tool', name: body.name, state: body.state })
    } else if (body.kind === 'approval') {
      entries.push({
        kind: 'approval',
        text: body.title,
        pending: waiting(item, body.resolution.state)
      })
    } else if (body.kind === 'question') {
      entries.push({
        kind: 'question',
        // Grouped prompts keep their real questions in `questions`; `question` is then a heading.
        text: agentSessionPromptQuestions(body)
          .map((q) => q.question)
          .join('\n'),
        pending: waiting(item, body.resolution.state)
      })
    }
  }
  return entries
}

export function formatChatList(result: { chats: ChatSessionEntry[] }): string {
  if (result.chats.length === 0) {
    return 'No chats.'
  }
  return result.chats
    .map((chat) =>
      [
        `${chat.worktree} · ${chat.agentType ?? 'agent'} · ${chat.state}`,
        `  session: ${chat.session}`,
        ...(chat.title ? [`  title: ${chat.title}`] : []),
        ...(chat.lastAssistantMessage
          ? [`  last reply: ${chat.lastAssistantMessage.replace(/\s+/g, ' ').slice(0, 200)}`]
          : [])
      ].join('\n')
    )
    .join('\n\n')
}

export function formatChatRead(result: {
  session: string
  entries: ChatTranscriptEntry[]
}): string {
  if (result.entries.length === 0) {
    return `No messages in ${result.session}.`
  }
  return result.entries
    .map((entry) => {
      if (entry.kind === 'message') {
        return `${entry.role}: ${entry.text}`
      }
      if (entry.kind === 'error') {
        return `[error] ${entry.text}`
      }
      if (entry.kind === 'tool') {
        return `[tool ${entry.name}: ${entry.state}]`
      }
      return `[${entry.kind}${entry.pending ? ', waiting for you' : ''}] ${entry.text}`
    })
    .join('\n')
}
