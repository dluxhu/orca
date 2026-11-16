// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useNativeChatMentionFiles } from './use-native-chat-mention-files'

vi.mock('@/store/index', () => ({ useAppStore: () => 'wt-1' }))
vi.mock('@/store/workspaces/selection/use-selected-worktree', () => ({
  useFileListWorktree: () => ({ path: '/repo' })
}))
vi.mock('@/lib/files/search/quick-open-file-history', () => ({ useQuickOpenHistory: () => [] }))
vi.mock('@/components/quick-open-file-list', () => ({
  useRuntimeFileListForWorktree: () => ({ files: ['README.md'], loading: false, loadError: null })
}))
vi.mock('@/components/quick-open-history-ranking', () => ({
  rankQuickOpenFilesWithHistory: (_query: string, files: string[]) =>
    files.map((path) => ({ path }))
}))
vi.mock('./use-native-chat-mention-sessions', () => ({
  useNativeChatMentionSessions: () => ({ sessions: [], loading: true })
}))

describe('useNativeChatMentionFiles', () => {
  it('is loading while the sessions are on their way, even with the files in', () => {
    const { result } = renderHook(() =>
      useNativeChatMentionFiles('', {
        terminalTabId: 'tab-1',
        targetPtyId: null,
        draft: '@',
        caret: 1,
        setActiveSuggestion: vi.fn()
      })
    )
    expect(result.current.files).toEqual(['README.md'])
    expect(result.current.loading).toBe(true)
  })
})
