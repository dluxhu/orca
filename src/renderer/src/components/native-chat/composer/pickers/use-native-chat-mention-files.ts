import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'
import { rankQuickOpenFilesWithHistory } from '@/components/quick-open-history-ranking'
import { useQuickOpenHistory } from '@/lib/files/search/quick-open-file-history'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/agent-session/tab-identity/structured-chat-tab-index'
import { useFileListWorktree } from '@/store/workspaces/selection/use-selected-worktree'

import type { NativeChatMentionItem, NativeChatMentionSession } from './native-chat-mentions'
import { useNativeChatMentionSessions } from './use-native-chat-mention-sessions'
import type { NativeChatStructuredComposerTransport } from '../submit/native-chat-structured-composer-transport'

const MENTION_FILE_LIMIT = 20
const NO_FILES: readonly string[] = []

export type NativeChatMentionFiles = {
  /** Workspace-relative paths, best match first. */
  files: readonly string[]
  loading: boolean
  failed: boolean
  /** Other chats and terminals, listed before the files. */
  sessions?: readonly NativeChatMentionSession[]
}

/** Sessions first, then files: the order of the menu and of its keyboard index. */
export function nativeChatMentionItems(mention: NativeChatMentionFiles): NativeChatMentionItem[] {
  return [...(mention.sessions ?? []), ...mention.files]
}

/** `query` is null while no `@` token is open. */
export function useNativeChatMentionFiles(
  query: string | null,
  composer: {
    terminalTabId: string
    structuredTransport?: Pick<NativeChatStructuredComposerTransport, 'worktreeId' | 'sessionId'>
    targetPtyId: string | null
  }
): NativeChatMentionFiles {
  const { terminalTabId, structuredTransport, targetPtyId } = composer
  const structuredWorktreeId = structuredTransport?.worktreeId
  const sessions = useNativeChatMentionSessions({
    query,
    terminalTabId,
    structuredWorktreeId,
    sessionId: structuredTransport?.sessionId,
    // A chat composer has no PTY of its own.
    ptyId: structuredTransport ? null : targetPtyId
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

  return useMemo(
    () => ({
      files:
        query === null
          ? NO_FILES
          : rankQuickOpenFilesWithHistory(query, list.files, history)
              .slice(0, MENTION_FILE_LIMIT)
              .map((item) => item.path),
      loading: list.loading,
      failed,
      sessions
    }),
    [failed, history, list.files, list.loading, query, sessions]
  )
}
