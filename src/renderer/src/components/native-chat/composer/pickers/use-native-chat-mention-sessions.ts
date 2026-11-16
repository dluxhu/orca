import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/index'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/agent-session/tab-identity/structured-chat-tab-index'
import type { RuntimeTerminalListResult } from '../../../../../../shared/runtime-terminal-contracts'
import type { RuntimeWorktreePsResult } from '../../../../../../shared/runtime-worktree-contracts'
import {
  filterNativeChatMentionSessions,
  listNativeChatMentionSessions,
  type NativeChatMentionSession
} from './native-chat-mentions'

const LIST_TIMEOUT_MS = 5_000
const NO_SESSIONS: readonly NativeChatMentionSession[] = []

/** The chats and terminals on this composer's host, read once each time an `@` token opens.
 * `loading` is true until both lists settle. */
export function useNativeChatMentionSessions(args: {
  query: string | null
  terminalTabId: string
  structuredWorktreeId?: string
  sessionId?: string
  ptyId: string | null
}): { sessions: readonly NativeChatMentionSession[]; loading: boolean } {
  const { query, terminalTabId, structuredWorktreeId, sessionId, ptyId } = args
  const open = query !== null
  const [sessions, setSessions] = useState(NO_SESSIONS)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSessions(NO_SESSIONS)
    setLoading(false)
    if (!open) {
      return
    }
    const state = useAppStore.getState()
    const worktreeId =
      structuredWorktreeId ?? findTerminalTabWorktreeId(state.tabsByWorktree, terminalTabId)
    const target = getRuntimeTargetForWorktreeOwner(state, worktreeId)
    if (!target) {
      return
    }
    const hostKey = target.kind === 'local' ? 'local' : target.environmentId
    let live = true
    setLoading(true)
    // A failed list leaves its kind out; files still show.
    void Promise.allSettled([
      callRuntimeRpc<RuntimeWorktreePsResult>(
        target,
        'worktree.ps',
        {},
        { timeoutMs: LIST_TIMEOUT_MS }
      ),
      callRuntimeRpc<RuntimeTerminalListResult>(
        target,
        'terminal.list',
        { includeVisualLayouts: false, includePreview: false },
        { timeoutMs: LIST_TIMEOUT_MS }
      )
    ]).then(([ps, terminals]) => {
      if (live) {
        setLoading(false)
        setSessions(
          listNativeChatMentionSessions(
            ps.status === 'fulfilled' ? ps.value : null,
            terminals.status === 'fulfilled' ? terminals.value : null,
            hostKey,
            { sessionId, ptyId }
          )
        )
      }
    })
    return () => {
      live = false
    }
  }, [open, ptyId, sessionId, structuredWorktreeId, terminalTabId])

  return useMemo(
    () => ({
      sessions: query === null ? NO_SESSIONS : filterNativeChatMentionSessions(sessions, query),
      loading
    }),
    [loading, query, sessions]
  )
}
