// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { nativeChatMentionItems, useNativeChatMentionFiles } from './use-native-chat-mention-files'

const session = {
  kind: 'chat' as const,
  label: 'Release notes',
  address: 'orca_session_id:chat_aaaaaaaa',
  hostKey: 'local',
  detail: 'repo/main'
}
const sessionsHook = vi.hoisted(() => ({
  result: { sessions: [] as unknown[], loading: false },
  queries: [] as (string | null)[]
}))

vi.mock('@/store/index', () => ({ useAppStore: () => 'wt-1' }))
vi.mock('@/store/workspaces/selection/use-selected-worktree', () => ({
  useFileListWorktree: () => ({ path: '/repo' })
}))
vi.mock('@/lib/files/search/quick-open-file-history', () => ({ useQuickOpenHistory: () => [] }))
vi.mock('@/components/file-actions/quick-open/quick-open-file-list', () => ({
  useRuntimeFileListForWorktree: () => ({ files: ['README.md'], loading: false, loadError: null })
}))
vi.mock('@/components/file-actions/quick-open/quick-open-history-ranking', () => ({
  rankQuickOpenFilesWithHistory: (_query: string, files: string[]) =>
    files.map((path) => ({ path }))
}))
vi.mock('./use-native-chat-mention-sessions', () => ({
  useNativeChatMentionSessions: ({ query }: { query: string | null }) => {
    sessionsHook.queries.push(query)
    return query === null ? { sessions: [], loading: false } : sessionsHook.result
  }
}))

describe('useNativeChatMentionFiles', () => {
  it('is loading while the sessions are on their way, even with the files in', () => {
    sessionsHook.result = { sessions: [], loading: true }
    const { result } = renderHook(() =>
      useNativeChatMentionFiles({ query: '', terminalTabId: 'tab-1', withSessions: true })
    )
    expect(result.current.files).toEqual(['README.md'])
    expect(result.current.loading).toBe(true)
  })

  it('lists sessions before files, in one keyboard order', () => {
    sessionsHook.result = { sessions: [session], loading: false }
    const { result } = renderHook(() =>
      useNativeChatMentionFiles({ query: 're', terminalTabId: 'tab-1', withSessions: true })
    )
    expect(result.current.files).toHaveLength(2)
    expect(nativeChatMentionItems(result.current)).toEqual([session, 'README.md'])
  })

  it('reads no sessions for a composer that cannot pick one', () => {
    sessionsHook.result = { sessions: [session], loading: false }
    sessionsHook.queries = []
    const { result } = renderHook(() =>
      useNativeChatMentionFiles({ query: 're', terminalTabId: 'tab-1' })
    )
    expect(result.current.files).toEqual(['README.md'])
    expect(sessionsHook.queries.every((query) => query === null)).toBe(true)
  })
})
