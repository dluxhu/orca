import { translate } from '@/i18n/i18n'
import type { AgentReferenceKind } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { removeMentionToken } from '../../../../../../shared/native-chat/input/composer/native-chat-composer-autocomplete'
import type { NativeChatComposerInput } from '../editor/native-chat-composer-input'
import type { NativeChatMentionSessionRow } from '../../../../../../shared/native-chat/native-chat-mention-sessions'

/** A row from the asking host's `nativeChat.mentionSessions`, keyed for the chip. */
export type NativeChatMentionSession = NativeChatMentionSessionRow & { hostKey: string }

export function nativeChatMentionKindLabel(kind: AgentReferenceKind): string {
  return kind === 'chat'
    ? translate('components.native-chat.composer.mentionChat', 'Chat')
    : translate('components.native-chat.composer.mentionTerminal', 'Terminal')
}

/** A workspace file path, or another chat or terminal. */
export type NativeChatMentionItem = string | NativeChatMentionSession

// The `@` list holds strings (files, bots); a session row's string starts with a character no path has.
const SESSION_VALUE_PREFIX = '\u0000session:'

/** The `@` list's string for a session row. */
export function nativeChatMentionSessionValue(session: NativeChatMentionSession): string {
  return `${SESSION_VALUE_PREFIX}${session.kind}:${session.hostKey}:${session.address}`
}

/** The session that an `@` list string names, or null for a file or a bot. */
export function nativeChatMentionSessionOf(
  sessions: readonly NativeChatMentionSession[] | undefined,
  value: string
): NativeChatMentionSession | null {
  if (!value.startsWith(SESSION_VALUE_PREFIX)) {
    return null
  }
  return sessions?.find((session) => nativeChatMentionSessionValue(session) === value) ?? null
}

const MENTION_SESSION_LIMIT = 20
export function filterNativeChatMentionSessions(
  sessions: readonly NativeChatMentionSession[],
  query: string
): NativeChatMentionSession[] {
  const needle = query.toLowerCase()
  return sessions
    .filter(
      (session) =>
        session.label.toLowerCase().includes(needle) ||
        session.detail.toLowerCase().includes(needle)
    )
    .slice(0, MENTION_SESSION_LIMIT)
}

/** A session becomes a chip in place of the `@query`; its send note names the orca command. */
export function completeNativeChatMention(
  input: Pick<NativeChatComposerInput, 'value' | 'selectionStart' | 'insertAgentReferences'> | null,
  session: NativeChatMentionSession,
  [draft, caret]: [string, number],
  commit: (result: { draft: string; caret: number }) => void
): void {
  const token = removeMentionToken(draft, caret)
  const { kind, label, address, hostKey, environment } = session
  const reference = environment
    ? { kind, label: `${label} (${environment})`, address, hostKey, environment }
    : { kind, label, address, hostKey }
  // A session that is already a chip inserts nothing, so the typed token stays.
  if (
    input?.insertAgentReferences?.([reference], {
      from: token.caret,
      to: caret
    })
  ) {
    commit({ draft: input.value, caret: input.selectionStart ?? input.value.length })
  }
}
