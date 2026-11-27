import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../core'

type Remote = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>
const remotes = vi.hoisted(() => new Map<string, Remote>())
const calls = vi.hoisted((): { environmentId: string; method: string; options: unknown }[] => [])

vi.mock('../../../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '<user-data>' })
}))
vi.mock('../../../../../shared/remote-runtime/host-store/runtime-environment-store', () => ({
  listEnvironments: () => [
    { id: 'env-laptop', name: 'laptop' },
    { id: 'env-dead', name: 'dead' },
    { id: 'env-wsl', name: 'wsl', orcadDeployment: { kind: 'wsl' } }
  ]
}))
vi.mock('../../../../wsl/host-lifecycle/wsl-host-gate', () => ({
  isGatedOffWslHost: (environment: { orcadDeployment?: { kind: string } }) =>
    environment.orcadDeployment?.kind === 'wsl'
}))
// Fake remote runtimes: no network.
vi.mock(
  '../../../../ipc/runtime-environments/requests/runtime-environment-transport-routing',
  () => ({
    callRuntimeEnvironment: async (
      _userDataPath: string,
      environmentId: string,
      method: string,
      params: unknown,
      _timeoutMs: number,
      _revision: unknown,
      _envelope: unknown,
      options: { signal: AbortSignal }
    ) => {
      calls.push({ environmentId, method, options })
      const remote = remotes.get(environmentId)
      if (!remote) {
        throw new Error(`no fake for ${environmentId}`)
      }
      return { ok: true, result: await remote(method, params, options.signal) }
    }
  })
)

const { NATIVE_CHAT_MENTION_SESSION_METHODS, collectNativeChatMentionSessions } =
  await import('./native-chat-mention-sessions')

const chatPs = (id: string, name: string, workspace: string) => ({
  worktrees: [
    {
      displayName: workspace,
      agents: [
        {
          paneKey: `structured-agent-session-${id}`,
          parentPaneKey: null,
          conversationName: name,
          displayName: null,
          taskTitle: null
        }
      ]
    }
  ]
})
const terminalList = (handle: string, ptyId: string, branch: string) => ({
  terminals: [{ handle, ptyId, branch, title: 'zsh', paneTitle: null }]
})

describe('nativeChat.mentionSessions', () => {
  it('lists its own sessions and those of its saved environments, without the asking chat', async () => {
    remotes.set('env-laptop', async (method) =>
      method === 'worktree.ps'
        ? // The same id as the asking chat: only the asking host leaves it out.
          chatPs('chat_aaaaaaaa', 'Laptop chat', 'docs')
        : terminalList('term_lap', 'pty-1', 'laptop-main')
    )
    remotes.set('env-dead', () => Promise.reject(new Error('unreachable')))
    calls.length = 0
    const runtime = {
      getWorktreePs: async () => ({
        worktrees: [
          ...chatPs('chat_aaaaaaaa', 'This chat', 'repo').worktrees,
          ...chatPs('chat_bbbbbbbb', 'Other chat', 'repo').worktrees
        ]
      }),
      listTerminals: async () => terminalList('term_own', 'pty-own', 'main')
    }
    const method = NATIVE_CHAT_MENTION_SESSION_METHODS[0]
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only `runtime`, and the fake has the two methods it calls.
    const context = { runtime } as unknown as RpcContext
    const result = await method.handler({ sessionId: 'chat_aaaaaaaa', ptyId: 'pty-own' }, context)
    expect(result.sessions).toEqual([
      {
        kind: 'chat',
        label: 'Other chat',
        address: 'orca_session_id:chat_bbbbbbbb',
        detail: 'repo'
      },
      {
        kind: 'chat',
        label: 'Laptop chat',
        address: 'orca_session_id:chat_aaaaaaaa',
        detail: 'docs',
        environment: 'laptop'
      },
      {
        // No agent row runs in it, so it is a plain shell.
        kind: 'shell',
        label: 'zsh',
        address: 'term_lap',
        detail: 'laptop-main',
        environment: 'laptop'
      }
    ])
    // A gated-off WSL host is never dialled, and a dial never starts one.
    expect(calls.map((call) => call.environmentId)).not.toContain('env-wsl')
    expect(calls[0].options).toMatchObject({ preparation: { wslStart: 'never' } })
  })

  it('leaves out a host that does not answer in time, and aborts its calls', async () => {
    let aborted: AbortSignal | undefined
    const silent = {
      environment: 'silent',
      ps: (signal: AbortSignal) => {
        aborted = signal
        return new Promise<never>(() => {})
      },
      terminals: () => new Promise<never>(() => {})
    }
    const live = {
      environment: 'laptop',
      ps: async () => chatPs('chat_cccccccc', 'Live chat', 'docs'),
      terminals: async () => ({ terminals: [] })
    }
    const result = await collectNativeChatMentionSessions([silent, live], {}, 20)
    expect(result.sessions.map((session) => session.label)).toEqual(['Live chat'])
    expect(aborted?.aborted).toBe(true)
  })

  it('asks every host at once, so two silent hosts cost one deadline', async () => {
    const asked: string[] = []
    const silent = (environment: string) => ({
      environment,
      ps: () => {
        asked.push(environment)
        return new Promise<never>(() => {})
      },
      terminals: () => new Promise<never>(() => {})
    })
    const pending = collectNativeChatMentionSessions([silent('one'), silent('two')], {}, 20)
    expect(asked).toEqual(['one', 'two'])
    expect((await pending).sessions).toEqual([])
  })

  it('leaves out a terminal list that is malformed', async () => {
    const broken = {
      environment: 'broken',
      ps: async () => ({ worktrees: [] }),
      terminals: async () => ({ terminals: [{ handle: 'term_x' }] })
    }
    const result = await collectNativeChatMentionSessions([broken], {})
    expect(result.sessions).toEqual([])
  })

  it('leaves out only the host whose list is malformed', async () => {
    const broken = {
      environment: 'broken',
      ps: async () => ({ worktrees: [{ displayName: 'x', agents: null }] }),
      terminals: async () => ({ terminals: [] })
    }
    const live = {
      ps: async () => ({ worktrees: [] }),
      terminals: async () => terminalList('term_own', 'pty-own', 'main')
    }
    const result = await collectNativeChatMentionSessions([broken, live], {})
    expect(result.sessions.map((session) => session.address)).toEqual(['term_own'])
  })
})
