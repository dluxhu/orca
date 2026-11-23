// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { useNativeChatMentionSessions } from './use-native-chat-mention-sessions'

type Pending = { params: unknown; resolve: (value: unknown) => void; reject: (e: unknown) => void }
const calls = vi.hoisted(() => new Map<string, Pending>())

vi.mock('@/store/index', () => ({ useAppStore: { getState: () => ({ tabsByWorktree: {} }) } }))
vi.mock('@/lib/files/access/file-owner-runtime-target', () => ({
  getRuntimeTargetForWorktreeOwner: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (_target: unknown, method: string, params: unknown) =>
    new Promise((resolve, reject) => calls.set(method, { params, resolve, reject }))
}))

const open = () =>
  renderHook(
    ({ query }) =>
      useNativeChatMentionSessions({
        query,
        terminalTabId: 'tab-1',
        structuredWorktreeId: 'wt-1',
        sessionId: 'chat_self',
        ptyId: null
      }),
    { initialProps: { query: '' } }
  )

beforeEach(() => calls.clear())

describe('useNativeChatMentionSessions', () => {
  it('asks its own host for every reachable session, and keys rows by host', async () => {
    const view = open()
    expect(view.result.current).toEqual({ sessions: [], loading: true })
    expect(calls.get('nativeChat.mentionSessions')?.params).toEqual({
      sessionId: 'chat_self',
      ptyId: null
    })
    await act(async () => {
      calls.get('nativeChat.mentionSessions')?.resolve({
        sessions: [
          { kind: 'terminal', label: 'Runner', address: 'term_one', detail: 'main' },
          {
            kind: 'chat',
            label: 'Notes',
            address: 'orca_session_id:chat_aaaaaaaa',
            detail: 'docs',
            environment: 'laptop'
          }
        ]
      })
    })
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.sessions.map((s) => [s.address, s.hostKey])).toEqual([
      ['term_one', 'local'],
      ['orca_session_id:chat_aaaaaaaa', 'local:laptop']
    ])
    view.rerender({ query: 'DOC' })
    expect(view.result.current.sessions.map((s) => s.label)).toEqual(['Notes'])
  })

  it('lists the own sessions of an older host that has no mention list', async () => {
    const view = open()
    await act(async () => {
      calls.get('nativeChat.mentionSessions')?.reject(
        new RuntimeRpcCallError({
          id: '1',
          ok: false,
          error: { code: 'method_not_found', message: 'Unknown method' },
          _meta: { runtimeId: 'r' }
        })
      )
    })
    expect(view.result.current.loading).toBe(true)
    await act(async () => {
      calls.get('worktree.ps')?.resolve({ worktrees: [] })
      calls.get('terminal.list')?.resolve({
        terminals: [{ handle: 'term_one', ptyId: 'pty-1', branch: 'main', title: 'Runner' }]
      })
    })
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.sessions.map((session) => session.address)).toEqual(['term_one'])
  })
})
