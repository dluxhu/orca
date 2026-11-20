// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useNativeChatMentionSessions } from './use-native-chat-mention-sessions'

const calls = vi.hoisted(() => new Map<string, (value: unknown) => void>())

vi.mock('@/store/index', () => ({ useAppStore: { getState: () => ({ tabsByWorktree: {} }) } }))
vi.mock('@/lib/files/access/file-owner-runtime-target', () => ({
  getRuntimeTargetForWorktreeOwner: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (_target: unknown, method: string) =>
    new Promise((resolve) => calls.set(method, resolve))
}))

describe('useNativeChatMentionSessions', () => {
  it('reports loading until both lists settle', async () => {
    const view = renderHook(() =>
      useNativeChatMentionSessions({
        query: '',
        terminalTabId: 'tab-1',
        structuredWorktreeId: 'wt-1',
        ptyId: null
      })
    )
    expect(view.result.current).toEqual({ sessions: [], loading: true })
    await act(async () => {
      calls.get('worktree.ps')?.({ worktrees: [] })
      calls.get('terminal.list')?.({
        terminals: [{ handle: 'term_one', ptyId: 'pty-1', branch: 'main', title: 'Runner' }]
      })
    })
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.sessions.map((session) => session.address)).toEqual(['term_one'])
  })
})
