import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { useAppStore } from '@/store/index'
import { useRuntimeFileListForWorktree } from '@/components/file-actions/quick-open/quick-open-file-list'
import { rankQuickOpenFilesWithHistory } from '@/components/file-actions/quick-open/quick-open-history-ranking'
import { useQuickOpenHistory } from '@/lib/files/search/quick-open-file-history'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/agent-session/tab-identity/structured-chat-tab-index'
import { useFileListWorktree } from '@/store/workspaces/selection/use-selected-worktree'

import {
  nativeChatMentionSessionOf,
  nativeChatMentionSessionValue,
  type NativeChatMentionItem,
  type NativeChatMentionSession
} from './native-chat-mentions'
import { useNativeChatMentionSessions } from './use-native-chat-mention-sessions'
import { useNativeChatMentionRowKeeper } from './use-native-chat-mention-row-keeper'

const MENTION_FILE_LIMIT = 20
const NO_FILES: readonly string[] = []

export type NativeChatMentionFiles = {
  /** Workspace-relative paths, best match first. Other chats and terminals come first, as
   *  `nativeChatMentionSessionValue` strings. */
  files: readonly string[]
  loading: boolean
  failed: boolean
  /** The sessions that the session strings in `files` name. */
  sessions?: readonly NativeChatMentionSession[]
}

/** The rows in menu order: sessions, then files. */
export function nativeChatMentionItems(mention: NativeChatMentionFiles): NativeChatMentionItem[] {
  return mention.files.map((value) => nativeChatMentionSessionOf(mention.sessions, value) ?? value)
}

/** `query` is null while no `@` token is open. */
export function useNativeChatMentionFiles(args: {
  query: string | null
  terminalTabId: string
  structuredWorktreeId?: string
  /** Also list other chats and terminals. */
  withSessions?: boolean
  /** This composer's own chat, left out of the sessions. */
  structuredSessionId?: string
  /** This composer's own terminal, left out of the sessions. */
  targetPtyId?: string | null
  /** With these, rows that arrive with no edit keep the highlighted row. */
  draft?: string
  caret?: number
  setActiveSuggestion?: Dispatch<SetStateAction<number>>
}): NativeChatMentionFiles {
  const { query, terminalTabId, structuredWorktreeId, structuredSessionId } = args
  const { sessions, loading: sessionsLoading } = useNativeChatMentionSessions({
    query: args.withSessions ? query : null,
    terminalTabId,
    structuredWorktreeId,
    sessionId: structuredSessionId,
    // A chat composer has no PTY of its own.
    ptyId: structuredSessionId ? null : (args.targetPtyId ?? null)
  })
  const enabled = query !== null
  // Closed is the common state, so the tab scan only runs while a token is open.
  const worktreeId = useAppStore((state) =>
    enabled
      ? (structuredWorktreeId ?? findTerminalTabWorktreeId(state.tabsByWorktree, terminalTabId))
      : null
  )
  const worktreePath = useFileListWorktree(worktreeId)?.path ?? null
  const history = useQuickOpenHistory(worktreeId, worktreePath)
  const list = useRuntimeFileListForWorktree({
    enabled,
    worktreeId,
    query: query ?? '',
    recentPaths: history
  })
  const failed = list.loadError !== null

  const mention = useMemo(
    () => ({
      files:
        query === null
          ? NO_FILES
          : [
              ...sessions.map(nativeChatMentionSessionValue),
              ...rankQuickOpenFilesWithHistory(query, list.files, history)
                .slice(0, MENTION_FILE_LIMIT)
                .map((item) => item.path)
            ],
      // Enter on an empty menu waits for both lists, so it never sends the `@` token.
      loading: list.loading || sessionsLoading,
      failed,
      sessions
    }),
    [failed, history, list.files, list.loading, query, sessions, sessionsLoading]
  )
  useNativeChatMentionRowKeeper(
    query === null ? null : mention.files,
    `${args.caret ?? ''}\0${args.draft ?? ''}`,
    args.setActiveSuggestion
  )
  return mention
}
