import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY } from '../../shared/agent-session/agent-session-runtime-capabilities'
import { structuredAgentSessionPayloadFingerprint } from '../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import { agentSessionSendFields } from '../../shared/agent-session/requests/structured-agent-session-send-mutation'
import { SendParams } from '../../shared/rpc-contract/structured-agent-session/structured-agent-session-params'
import { structuredAgentSessionTabId } from '../../shared/agent-session/view/structured-agent-session-projection'
import type { RuntimeCapability } from '../../shared/remote-runtime/protocol/protocol-version'
import { RuntimeClient } from '../runtime/client'
import { RuntimeClientError, RuntimeRpcFailureError } from '../runtime/connection/types'
import { CHAT_HANDLERS } from './chat'

const SESSION = 'codex_8eb631ab_59c5_41e4_8672_01cfe0a6fd5f'

function ok(result: unknown) {
  return { id: 'req', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function historyPage(items: unknown[], fence: number | null = 3, hasOlder = false) {
  return ok({ ok: true, page: pageOf(items, fence, hasOlder) })
}

function pageOf(items: unknown[], fence: number | null, hasOlder = false) {
  return {
    sessionId: SESSION,
    epoch: 'e',
    ...(fence === null ? {} : { fence }),
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions: [],
    window: { oldest: null, newest: null, nextCursor: { epoch: 'e', sequence: 9 } },
    hasOlder,
    hasNewer: false
  }
}

function message(role: string, text: string) {
  return {
    itemId: `${role}-${text}`,
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] }
  }
}

function fakeClient(
  responses: unknown[],
  {
    isRemote = false,
    capabilities = [AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY]
  }: { isRemote?: boolean; capabilities?: RuntimeCapability[] } = {}
): RuntimeClient & { call: ReturnType<typeof vi.fn> } {
  const client = new RuntimeClient('/tmp/orca-chat-test', 60_000, null, null)
  vi.spyOn(client, 'isRemote', 'get').mockReturnValue(isRemote)
  const call = vi.fn()
  for (const response of responses) {
    call.mockResolvedValueOnce(response)
  }
  vi.spyOn(client, 'call').mockImplementation(call)
  vi.spyOn(client, 'getCliStatus').mockResolvedValue({
    id: 'status',
    ok: true,
    result: {
      app: { running: true, pid: 123 },
      runtime: { state: 'ready', reachable: true, runtimeId: 'runtime-1', capabilities },
      graph: { state: 'ready' }
    },
    _meta: { runtimeId: 'runtime-1' }
  })
  return Object.assign(client, { call })
}

async function run(
  command: string,
  flags: Record<string, string | boolean>,
  client: RuntimeClient
) {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => logs.push(line))
  try {
    await CHAT_HANDLERS[command]!({
      flags: new Map(Object.entries(flags)),
      client,
      cwd: '/tmp',
      json: true
    })
  } finally {
    spy.mockRestore()
  }
  return JSON.parse(logs.join('\n')).result
}

describe('chat list', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists top-level chat tabs only, with id, title, agent and state', async () => {
    const agent = (paneKey: string, extra: Record<string, unknown> = {}) => ({
      paneKey,
      parentPaneKey: null,
      state: 'working',
      agentType: 'codex',
      taskTitle: 'task',
      displayName: null,
      lastAssistantMessage: 'hi',
      updatedAt: 5,
      ...extra
    })
    const client = fakeClient([
      ok({
        worktrees: [
          {
            worktreeId: 'w1',
            displayName: 'main',
            agents: [
              agent(`${structuredAgentSessionTabId(SESSION)}:leaf`, { conversationName: 'Fix CI' }),
              agent('terminal-pane-1'),
              agent(`${structuredAgentSessionTabId('child')}:leaf`, { parentPaneKey: 'x' }),
              agent(`${structuredAgentSessionTabId('done_1')}:leaf`, { state: 'done' })
            ]
          }
        ]
      })
    ])
    const result = await run('chat list', { state: 'working' }, client)
    expect(client.call).toHaveBeenCalledWith('worktree.ps', {})
    expect(result.chats).toEqual([
      {
        session: SESSION,
        worktreeId: 'w1',
        worktree: 'main',
        agentType: 'codex',
        state: 'working',
        title: 'Fix CI',
        lastAssistantMessage: 'hi',
        updatedAt: 5
      }
    ])
  })

  it('rejects an unknown --state before calling the host', async () => {
    const client = fakeClient([])
    await expect(run('chat list', { state: 'busy' }, client)).rejects.toThrow(
      '--state must be one of'
    )
    expect(client.call).not.toHaveBeenCalled()
  })
})

describe('chat read', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads one tail page and keeps the newest --limit entries', async () => {
    const client = fakeClient([
      historyPage(
        [
          message('user', 'one'),
          message('reasoning', 'hmm'),
          message('assistant', 'two'),
          message('user', 'three')
        ],
        3,
        true
      )
    ])
    const result = await run(
      'chat read',
      { session: structuredAgentSessionTabId(SESSION), limit: '2' },
      client
    )
    expect(client.call).toHaveBeenCalledWith('agentSession.history', {
      sessionId: SESSION,
      direction: 'tail',
      limit: 200
    })
    expect(result).toEqual({
      session: SESSION,
      entries: [
        { kind: 'message', role: 'assistant', text: 'two' },
        { kind: 'message', role: 'user', text: 'three' }
      ],
      truncated: false
    })
  })

  it('refuses --limit above 100 before any call', async () => {
    const local = fakeClient([])
    await expect(run('chat read', { session: SESSION, limit: '101' }, local)).rejects.toThrow(
      '--limit must be at most 100'
    )
    expect(local.call).not.toHaveBeenCalled()
  })

  it('explains a paired host that does not admit CLI reads', async () => {
    const paired = fakeClient([], { isRemote: true })
    paired.call.mockRejectedValueOnce(
      new RuntimeClientError('runtime_error', 'structured_agent_session_unsupported')
    )
    await expect(run('chat read', { session: SESSION }, paired)).rejects.toMatchObject({
      code: 'incompatible_runtime',
      message: expect.stringContaining('cannot read chats from the CLI')
    })
  })

  it('names a chat that is not open instead of the bare wire code', async () => {
    const client = fakeClient([])
    client.call.mockRejectedValueOnce(
      new RuntimeClientError('runtime_error', 'agent_session_identity_required')
    )
    await expect(run('chat read', { session: SESSION }, client)).rejects.toThrow(
      `No chat with session id ${SESSION} on this host.`
    )
  })
})

describe('chat send', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends a host-valid envelope fenced to the runtime it read, queued while the agent works', async () => {
    const client = fakeClient([
      historyPage([], 7),
      ok({
        ok: true,
        replayed: false,
        fence: 7,
        cursor: { epoch: 'e', sequence: 2 },
        value: {
          clientMessageId: 'm-1',
          queued: { messageId: 'q-1', position: 1, state: 'waiting' }
        }
      })
    ])
    const result = await run('chat send', { session: SESSION, text: 'Run the tests' }, client)
    expect(client.call.mock.calls[0]).toEqual([
      'agentSession.history',
      { sessionId: SESSION, direction: 'tail', limit: 1 }
    ])
    const [method, params] = client.call.mock.calls[1]!
    expect(method).toBe('agentSession.send')
    // The host validates this schema and hashes these fields, so a bad envelope fails here.
    expect(SendParams.safeParse(params).success).toBe(true)
    expect(params.envelope.clientOperationId).toMatch(/^\d{13}-[0-9a-f]{32}$/)
    expect(params.envelope.payloadFingerprint).toBe(
      structuredAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: SESSION,
        fields: agentSessionSendFields(params)
      })
    )
    expect(params).toMatchObject({
      envelope: { sessionId: SESSION, expectedRuntimeFence: 7 },
      delivery: 'queue-if-active',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Run the tests' }] }
    })
    expect(result).toEqual({
      session: SESSION,
      delivery: 'queued',
      clientMessageId: 'm-1',
      queuePosition: 1
    })
  })

  it('sends a plain message to a host without the queue capability', async () => {
    const client = fakeClient(
      [
        historyPage([], 2),
        ok({
          ok: true,
          replayed: false,
          fence: 2,
          cursor: { epoch: 'e', sequence: 2 },
          value: { clientMessageId: 'm-2' }
        })
      ],
      { capabilities: [] }
    )
    const result = await run('chat send', { session: SESSION, text: 'hi' }, client)
    expect(client.call.mock.calls[1]![1]).not.toHaveProperty('delivery')
    expect(result).toEqual({ session: SESSION, delivery: 'submitted', clientMessageId: 'm-2' })
  })

  it('reports a host refusal as an error, never as sent', async () => {
    const client = fakeClient([
      historyPage([], 2),
      ok({
        ok: false,
        refusal: { code: 'agent_session_fence_mismatch', message: 'The chat restarted.' }
      })
    ])
    await expect(run('chat send', { session: SESSION, text: 'hi' }, client)).rejects.toMatchObject({
      code: 'agent_session_fence_mismatch'
    })
  })

  it('fences to the page fence first, as the renderer does, then to a reset fence', async () => {
    const sent = {
      ok: true,
      replayed: false,
      fence: 5,
      cursor: null,
      value: { clientMessageId: 'm' }
    }
    const reset = (fence: number | null) =>
      ok({ ok: false, reset: 'epoch-changed', fence: 9, page: pageOf([], fence) })
    const both = fakeClient([reset(5), ok(sent)])
    await run('chat send', { session: SESSION, text: 'hi' }, both)
    expect(both.call.mock.calls[1]![1].envelope.expectedRuntimeFence).toBe(5)
    const resetOnly = fakeClient([reset(null), ok(sent)])
    await run('chat send', { session: SESSION, text: 'hi' }, resetOnly)
    expect(resetOnly.call.mock.calls[1]![1].envelope.expectedRuntimeFence).toBe(9)
  })

  it('says the message may have been sent when the send request was lost', async () => {
    const client = fakeClient([historyPage([], 2)])
    client.call.mockRejectedValueOnce(
      new RuntimeClientError(
        'runtime_timeout',
        'Timed out waiting for the Orca runtime to respond.'
      )
    )
    await expect(run('chat send', { session: SESSION, text: 'hi' }, client)).rejects.toMatchObject({
      code: 'runtime_timeout',
      message: expect.stringContaining(
        'The message may have been sent; check `orca chat read` before you send it again.'
      )
    })
  })

  it('reports an RPC failure from the host as not sent', async () => {
    const client = fakeClient([historyPage([], 2)])
    client.call.mockRejectedValueOnce(
      new RuntimeRpcFailureError({
        id: 'req',
        ok: false,
        error: { code: 'runtime_error', message: 'structured_agent_session_unsupported' }
      })
    )
    const failure = run('chat send', { session: SESSION, text: 'hi' }, client)
    await expect(failure).rejects.toMatchObject({ code: 'incompatible_runtime' })
    await expect(failure).rejects.not.toThrow('may have been sent')
  })

  it('sends nothing for an empty message or a chat with no runtime', async () => {
    const empty = fakeClient([])
    await expect(run('chat send', { session: SESSION, text: '  ' }, empty)).rejects.toThrow(
      'must not be empty'
    )
    expect(empty.call).not.toHaveBeenCalled()

    const stopped = fakeClient([historyPage([], null)])
    await expect(run('chat send', { session: SESSION, text: 'hi' }, stopped)).rejects.toThrow(
      'nothing was sent'
    )
    expect(stopped.call).toHaveBeenCalledTimes(1)
  })
})

function chatClient(isRemote: boolean): { client: RuntimeClient; call: ReturnType<typeof vi.fn> } {
  const client = new RuntimeClient('/tmp/orca-chat-test', 60_000, null, null)
  vi.spyOn(client, 'isRemote', 'get').mockReturnValue(isRemote)
  const call = vi.fn().mockResolvedValue({
    id: 'req-rename',
    ok: true,
    result: { name: 'Release notes', applied: true },
    _meta: { runtimeId: 'runtime-1' }
  })
  vi.spyOn(client, 'call').mockImplementation(call)
  return { client, call }
}

function rename(client: RuntimeClient, session?: string): Promise<void> {
  return CHAT_HANDLERS['chat rename']({
    flags: new Map([
      ['name', 'Release notes'],
      ...(session === undefined ? [] : [['session', session] as const])
    ]),
    client,
    cwd: '/tmp/worktree',
    json: true
  })
}

describe('chat rename CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('never sends this machine’s chat id to a paired host', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'chat-7')
    const { client, call } = chatClient(true)

    await expect(rename(client)).rejects.toThrow('Missing required --session: on a paired host')
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses an empty --session instead of renaming the chat it runs in', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'chat-7')
    const { client, call } = chatClient(false)

    await expect(rename(client, '')).rejects.toThrow('Missing value for --session')
    expect(call).not.toHaveBeenCalled()
  })
})
