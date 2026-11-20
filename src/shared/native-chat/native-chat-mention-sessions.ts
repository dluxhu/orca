import { z } from 'zod'
import { structuredAgentSessionTabId } from '../agent-session/view/structured-agent-session-projection'
import {
  formatOrcaSessionAddress,
  isOrcaSessionId
} from '../agent-session/identity/orca-session-address'
import type { AgentReferenceKind } from '../orchestration/mailbox/orchestration-agent-reference'

/** Lists the chats and terminals that the agent of a chat can reach: its own host and its saved environments. */
export const NATIVE_CHAT_MENTION_SESSIONS_METHOD = 'nativeChat.mentionSessions'

export const NativeChatMentionSessionsParams = z.object({
  /** The asking chat, left out of the list. */
  sessionId: z.string().optional(),
  /** The asking terminal, left out of the list. */
  ptyId: z.string().nullable().optional()
})

export type NativeChatMentionSessionRow = {
  kind: AgentReferenceKind
  label: string
  /** `orca_session_id:<id>` for a chat, the terminal handle for a terminal. */
  address: string
  /** The workspace of the session, to tell same-named sessions apart. */
  detail: string
  /** The saved environment name that reaches the session; absent on the asking host. */
  environment?: string
}

export type NativeChatMentionSessionsResult = { sessions: NativeChatMentionSessionRow[] }

const CHAT_TAB_PREFIX = structuredAgentSessionTabId('')

// Only the fields the list reads. A remote host's answer is checked before use.
const MentionPs = z.object({
  worktrees: z.array(
    z.object({
      displayName: z.string(),
      agents: z.array(
        z.object({
          paneKey: z.string(),
          parentPaneKey: z.string().nullable(),
          conversationName: z.string().nullish(),
          displayName: z.string().nullish(),
          taskTitle: z.string().nullish()
        })
      )
    })
  )
})

const MentionTerminals = z.object({
  terminals: z.array(
    z.object({
      handle: z.string(),
      ptyId: z.string().nullish(),
      tabId: z.string().nullish(),
      leafId: z.string().nullish(),
      branch: z.string(),
      title: z.string().nullish(),
      paneTitle: z.string().nullish(),
      orphaned: z.boolean().nullish()
    })
  )
})

/** The chats and terminals of one host, from its `worktree.ps` and `terminal.list` results; `self` is left out.
 * A missing or malformed list leaves its kind out. */
export function listNativeChatMentionSessionRows(
  psResult: unknown,
  terminalsResult: unknown,
  self: { sessionId?: string; ptyId?: string | null }
): NativeChatMentionSessionRow[] {
  const ps = MentionPs.safeParse(psResult).data
  const terminals = MentionTerminals.safeParse(terminalsResult).data
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
            detail: terminal.branch
          }
        ]
  )
  return [...chats, ...ptys]
}
