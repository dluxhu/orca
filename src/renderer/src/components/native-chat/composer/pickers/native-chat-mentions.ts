import { translate } from '@/i18n/i18n'
import { structuredAgentSessionTabId } from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import {
  formatOrcaSessionAddress,
  isOrcaSessionId
} from '../../../../../../shared/orca-session-address'
import type { AgentReferenceKind } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import {
  applyMentionSuggestion,
  removeMentionToken
} from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { NativeChatComposerInput } from '../editor/native-chat-composer-input'
import type { RuntimeTerminalSummary } from '../../../../../../shared/runtime-terminal-contracts'
import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../../../../../../shared/runtime-worktree-contracts'

export type NativeChatMentionSession = {
  kind: AgentReferenceKind
  label: string
  /** `orca_session_id:<id>` for a chat, the terminal handle for a terminal. */
  address: string
  hostKey: string
  /** The workspace of the session, to tell same-named sessions apart. */
  detail: string
}

export function nativeChatMentionKindLabel(kind: AgentReferenceKind): string {
  return kind === 'chat'
    ? translate('components.native-chat.composer.mentionChat', 'Chat')
    : translate('components.native-chat.composer.mentionTerminal', 'Terminal')
}

/** A workspace file path, or another chat or terminal. */
export type NativeChatMentionItem = string | NativeChatMentionSession

const MENTION_SESSION_LIMIT = 20
const CHAT_TAB_PREFIX = structuredAgentSessionTabId('')

/** The chats and terminals of one host that this composer can mention; `self` is left out. */
export function listNativeChatMentionSessions(
  ps: {
    worktrees: readonly (Pick<RuntimeWorktreePsSummary, 'displayName'> & {
      agents: readonly Pick<
        RuntimeWorktreeAgentRow,
        'paneKey' | 'parentPaneKey' | 'conversationName' | 'displayName' | 'taskTitle'
      >[]
    })[]
  } | null,
  terminals: {
    terminals: readonly Pick<
      RuntimeTerminalSummary,
      'handle' | 'ptyId' | 'tabId' | 'leafId' | 'branch' | 'title' | 'paneTitle' | 'orphaned'
    >[]
  } | null,
  hostKey: string,
  self: { sessionId?: string; ptyId?: string | null }
): NativeChatMentionSession[] {
  const chats = (ps?.worktrees ?? []).flatMap((worktree) =>
    worktree.agents.flatMap((agent) => {
      if (agent.parentPaneKey !== null || !agent.paneKey.startsWith(CHAT_TAB_PREFIX)) {
        return []
      }
      const id = agent.paneKey.slice(CHAT_TAB_PREFIX.length).split(':')[0]
      if (!isOrcaSessionId(id) || id === self.sessionId) {
        return []
      }
      return [
        {
          kind: 'chat' as const,
          label: agent.conversationName || agent.displayName || agent.taskTitle || id,
          address: formatOrcaSessionAddress(id),
          hostKey,
          detail: worktree.displayName
        }
      ]
    })
  )
  // A terminal with an agent row reads Orca mail; a plain shell does not.
  const agentPanes = new Set(
    (ps?.worktrees ?? []).flatMap((worktree) => worktree.agents.map((agent) => agent.paneKey))
  )
  const ptys = (terminals?.terminals ?? []).flatMap((terminal) =>
    terminal.orphaned || (self.ptyId && terminal.ptyId === self.ptyId)
      ? []
      : [
          {
            kind: agentPanes.has(`${terminal.tabId}:${terminal.leafId}`)
              ? ('terminal' as const)
              : ('shell' as const),
            label: terminal.paneTitle || terminal.title || terminal.handle,
            address: terminal.handle,
            hostKey,
            detail: terminal.branch
          }
        ]
  )
  return [...chats, ...ptys]
}

export function filterNativeChatMentionSessions(
  sessions: readonly NativeChatMentionSession[],
  query: string
): NativeChatMentionSession[] {
  const needle = query.toLowerCase()
  return sessions
    .filter((session) => session.label.toLowerCase().includes(needle))
    .slice(0, MENTION_SESSION_LIMIT)
}

/** A file becomes its `@path` text; a session becomes a chip whose send note names the orca command. */
export function completeNativeChatMention(
  input: Pick<NativeChatComposerInput, 'value' | 'selectionStart' | 'insertAgentReferences'> | null,
  item: NativeChatMentionItem,
  [draft, caret]: [string, number],
  commit: (result: { draft: string; caret: number }) => void
): void {
  if (typeof item === 'string') {
    commit(applyMentionSuggestion(draft, caret, item))
    return
  }
  const token = removeMentionToken(draft, caret)
  const { kind, label, address, hostKey } = item
  // A session that is already a chip inserts nothing, so the typed token stays.
  if (
    input?.insertAgentReferences?.([{ kind, label, address, hostKey }], {
      from: token.caret,
      to: caret
    })
  ) {
    commit({ draft: input.value, caret: input.selectionStart ?? input.value.length })
  }
}
