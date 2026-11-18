import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/index'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import { chatWorkspaceByTabId as findTerminalTabWorktreeId } from '../../../../lib/agent-session/tab-identity/structured-chat-tab-index'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type { RuntimeTerminalListResult } from '../../../../../../shared/runtime-terminal-contracts'
import type { RuntimeWorktreePsResult } from '../../../../../../shared/runtime-worktree-contracts'
import {
  listNativeChatMentionSessionRows,
  NATIVE_CHAT_MENTION_SESSIONS_METHOD,
  type NativeChatMentionSessionRow,
  type NativeChatMentionSessionsResult
} from '../../../../../../shared/native-chat/native-chat-mention-sessions'
import { filterNativeChatMentionSessions, type NativeChatMentionSession } from './native-chat-mentions'

// The host gives up on a silent saved environment first, so this is a backstop.
const LIST_TIMEOUT_MS = 5_000
const NO_SESSIONS: readonly NativeChatMentionSession[] = []

type Self = { sessionId?: string; ptyId: string | null }

/** The chats and terminals that the composer's host reaches: its own and those of its saved environments. */
async function readMentionRows(
  target: RuntimeClientTarget,
  self: Self
): Promise<NativeChatMentionSessionRow[]> {
  try {
    const result = await callRuntimeRpc<NativeChatMentionSessionsResult>(
      target,
      NATIVE_CHAT_MENTION_SESSIONS_METHOD,
      self,
      { timeoutMs: LIST_TIMEOUT_MS }
    )
    return result.sessions
  } catch (error) {
    if (!(error instanceof RuntimeRpcCallError && error.code === 'method_not_found')) {
      throw error
    }
  }
  // An older host lists only its own sessions. A failed list leaves its kind out.
  const [ps, terminals] = await Promise.allSettled([
    callRuntimeRpc<RuntimeWorktreePsResult>(target, 'worktree.ps', {}, { timeoutMs: LIST_TIMEOUT_MS }),
    callRuntimeRpc<RuntimeTerminalListResult>(
      target,
      'terminal.list',
      { includeVisualLayouts: false, includePreview: false },
      { timeoutMs: LIST_TIMEOUT_MS }
    )
  ])
  return listNativeChatMentionSessionRows(
    ps.status === 'fulfilled' ? ps.value : null,
    terminals.status === 'fulfilled' ? terminals.value : null,
    self
  )
}

/** The `@` menu sessions, read once each time an `@` token opens. `loading` is true until the list settles. */
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
    void readMentionRows(target, { sessionId, ptyId })
      .catch(() => [])
      .then((rows) => {
        if (live) {
          setLoading(false)
          setSessions(
            rows.map((row) => ({
              ...row,
              hostKey: row.environment ? `${hostKey}:${row.environment}` : hostKey
            }))
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
