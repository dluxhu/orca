import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentJournalItemBody } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentJournalItemIdentity } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import type {
  StructuredAgentSessionEventSink,
  StructuredAgentSessionItemAppendOptions
} from '../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import type { StructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/host/structured-agent-session-logger'
import { createClaudeControlSurface } from '../sdk-transport/claude-agent-sdk-control-requests'
import type { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import {
  PROVIDER_SESSION_ID,
  USER_MESSAGE,
  adapterFor,
  claudeWasSent,
  claudeFrame,
  fakeClaude,
  identityFor,
  tick
} from './claude-structured-session-test-support'

type RemoteControlCall = { enabled: boolean; reattachSessionId?: string }

const REMOTE_PROMPT = {
  type: 'user',
  uuid: 'remote-prompt-1',
  parent_tool_use_id: null,
  isReplay: true,
  origin: { kind: 'human' },
  message: { role: 'user', content: 'run the tests from my phone' }
}

/** The CLI's own Stop marker, captured from 2.1.2xx: a root user frame that is not a replay. */
const STOP_MARKER: Record<string, unknown> = JSON.parse(
  readFileSync(
    join(__dirname, '../__fixtures__/claude-lifecycle-capture-interrupt-lost.jsonl'),
    'utf8'
  ).split('\n')[16]!
).frame

/** CLI answers the test settles by hand, in the order it chooses. */
function heldReplies() {
  const held: PromiseWithResolvers<unknown>[] = []
  let holding = false
  return {
    hold: () => {
      holding = true
    },
    reply: () => {
      if (!holding) {
        return undefined
      }
      const answer = Promise.withResolvers<unknown>()
      held.push(answer)
      return answer.promise
    },
    answer: (index: number) => held[index]!
  }
}

const promptRow = (uuid: string) => ({ provider: 'claude', sessionId: PROVIDER_SESSION_ID, uuid })

const owned: { claude: ReturnType<typeof fakeClaude>; adapter: ClaudeStructuredSessionAdapter }[] =
  []

afterEach(async () => {
  for (const { claude, adapter } of owned.splice(0)) {
    claude.dispose()
    await adapter.closeAll()
  }
})

/** A Claude chat whose CLI answers `remote_control` like 2.1.325 and whose journal rows are kept. */
async function chat(
  options: {
    newChats?: boolean
    resumed?: boolean
    initialization?: Record<string, unknown>
    reply?: (call: RemoteControlCall) => Promise<unknown> | undefined
  } = {}
) {
  const calls: RemoteControlCall[][] = []
  const items: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const scopes = new Map<string, StructuredAgentSessionItemAppendOptions['turnScope']>()
  const warnings: string[] = []
  const logger: StructuredAgentSessionLogger = {
    warn: (message) => warnings.push(message),
    error: (message) => warnings.push(message)
  }
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body, appendOptions) => {
      items.push({ identity, body })
      if (identity.provider === 'claude' && body.kind === 'message') {
        scopes.set(identity.uuid, appendOptions.turnScope)
      }
    },
    appendTombstone: () => {},
    publish: () => {}
  }
  const claude = fakeClaude()
  const open = claude.openConnection
  claude.openConnection = async (...args) => {
    const connection = await open(...args)
    const own: RemoteControlCall[] = []
    calls.push(own)
    const read = connection.initializationResult
    connection.initializationResult = () =>
      read().then((reply) => Object.assign({}, reply, options.initialization))
    connection.setRemoteControl = (enabled, request) => {
      const call = {
        enabled,
        ...(request?.reattachSessionId ? { reattachSessionId: request.reattachSessionId } : {})
      }
      own.push(call)
      return (
        options.reply?.(call) ??
        Promise.resolve(
          enabled
            ? {
                session_url: 'https://claude.ai/code/session_01',
                connect_url: 'https://claude.ai/code?environment=env_01',
                environment_id: 'env_01',
                bridge_epoch: 1,
                bridge_session_id: 'session_01'
              }
            : {}
        )
      )
    }
    return connection
  }
  const adapter = adapterFor(claude, options.resumed ? { resumesTranscript: true } : {})
  Object.assign(adapter['deps'], {
    remoteControlForNewChats: () => options.newChats === true,
    logger
  })
  owned.push({ claude, adapter })
  const start = async (fence: number) => {
    await adapter.acquire({
      identity: identityFor(),
      fence,
      spawnToken: `spawn-${fence}`,
      events: sink
    })
    await tick()
  }
  await start(7)
  const userRows = (uuid: string) =>
    items.filter(
      ({ identity, body }) =>
        body.kind === 'message' &&
        body.role === 'user' &&
        identity.provider === 'claude' &&
        identity.uuid === uuid
    )
  const runningTurnsOn = (uuid: string) =>
    items.filter(
      ({ body }) =>
        body.kind === 'turn' && body.state === 'running' && body.userItemId?.endsWith(`:${uuid}`)
    )
  return {
    adapter,
    claude,
    calls,
    items,
    scopes,
    warnings,
    userRows,
    runningTurnsOn,
    start,
    frame: (message: Record<string, unknown>) => claudeFrame(claude.connections.at(-1)!, message),
    turnOn: () => adapter.remoteControl({ sessionId: 'session-1', enabled: true }),
    turnOff: () => adapter.remoteControl({ sessionId: 'session-1', enabled: false }),
    state: () => adapter.remoteControl({ sessionId: 'session-1' })
  }
}

describe('Claude Remote Control control request', () => {
  it('sends enableRemoteControl with the bridge session to reattach', async () => {
    const received: unknown[][] = []
    const query = {
      enableRemoteControl: async (...args: unknown[]) => {
        received.push(args)
        return { session_url: 'https://claude.ai/code/session_01' }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the surface reads only enableRemoteControl from this stub.
    const controls = createClaudeControlSurface(query as unknown as Query)

    await expect(
      controls.setRemoteControl?.(true, { reattachSessionId: 'session_01' })
    ).resolves.toEqual({ session_url: 'https://claude.ai/code/session_01' })
    await controls.setRemoteControl?.(false)

    expect(received).toEqual([
      [true, undefined, { reattachSessionId: 'session_01' }],
      [false, undefined, undefined]
    ])
  })
})

describe('Claude chat Remote Control', () => {
  it('stays off for a new chat unless the setting asks for it', async () => {
    const off = await chat()
    const on = await chat({ newChats: true })

    expect(off.calls).toEqual([[]])
    await expect(off.state()).resolves.toEqual({ enabled: false, sessionUrl: null })
    expect(on.calls).toEqual([[{ enabled: true }]])
    await expect(on.state()).resolves.toEqual({
      enabled: true,
      sessionUrl: 'https://claude.ai/code/session_01'
    })
  })

  it("follows the user's own auto-connect setting, not an org default alone", async () => {
    const own = await chat({ initialization: { remote_control_auto_enable: true } })
    const orgDefault = await chat({
      initialization: {
        remote_control_auto_enable: true,
        remote_control_auto_on_by_default: true
      }
    })

    expect([own.calls, orgDefault.calls]).toEqual([[[{ enabled: true }]], [[]]])
  })

  it('turns on and off from the chat', async () => {
    const { adapter, calls } = await chat()

    await expect(adapter.remoteControl({ sessionId: 'session-1', enabled: true })).resolves.toEqual(
      { enabled: true, sessionUrl: 'https://claude.ai/code/session_01' }
    )
    await expect(
      adapter.remoteControl({ sessionId: 'session-1', enabled: false })
    ).resolves.toEqual({ enabled: false, sessionUrl: null })
    expect(calls).toEqual([[{ enabled: true }, { enabled: false }]])
  })

  it('keeps a chat on Remote Control running through the idle stop', async () => {
    const { adapter } = await chat()
    expect(adapter.confirmIdle('session-1')).toBeUndefined()

    await adapter.remoteControl({ sessionId: 'session-1', enabled: true })

    await expect(adapter.confirmIdle('session-1')).resolves.toBe('busy')
  })

  it('shows a prompt sent from claude.ai and opens its turn', async () => {
    const { adapter, claude, items } = await chat()
    await adapter.remoteControl({ sessionId: 'session-1', enabled: true })

    claudeFrame(claude.connections[0]!, {
      type: 'user',
      uuid: 'remote-prompt-1',
      parent_tool_use_id: null,
      isReplay: true,
      origin: { kind: 'human' },
      message: { role: 'user', content: 'run the tests from my phone' }
    })

    const prompt = promptRow('remote-prompt-1')
    expect(items).toContainEqual({
      identity: prompt,
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'run the tests from my phone' }]
      }
    })
    expect(items.map(({ body }) => body)).toContainEqual(
      expect.objectContaining({
        kind: 'turn',
        state: 'running',
        userItemId: 'claude:819cf9f8-e43c-4ad7-b50f-54aa158a726a:remote-prompt-1'
      })
    )
  })

  it('turns on again after a restart, reattached, and reads off until the CLI confirms', async () => {
    const pending = Promise.withResolvers<unknown>()
    let restarted = false
    const { adapter, calls, start, state } = await chat({
      reply: (call) => (restarted && call.enabled ? pending.promise : undefined)
    })
    await adapter.remoteControl({ sessionId: 'session-1', enabled: true })
    await adapter.closeSession('session-1')
    restarted = true

    await start(8)

    expect(calls).toEqual([
      [{ enabled: true }],
      [{ enabled: true, reattachSessionId: 'session_01' }]
    ])
    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
    pending.resolve({ session_url: 'https://claude.ai/code/session_01' })
    await tick()
    await expect(state()).resolves.toEqual({
      enabled: true,
      sessionUrl: 'https://claude.ai/code/session_01'
    })
  })

  it('keeps a Turn Off across a restart, even with the CLI asking to auto-connect', async () => {
    const { calls, start, turnOff, state, adapter } = await chat({
      initialization: { remote_control_auto_enable: true }
    })
    await turnOff()
    await adapter.closeSession('session-1')

    await start(8)

    expect(calls).toEqual([[{ enabled: true }, { enabled: false }], []])
    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
  })

  it('forgets the bridge session on Turn Off, so a later Turn On starts a new one', async () => {
    const { calls, turnOn, turnOff } = await chat()
    await turnOn()
    await turnOff()
    await turnOn()

    expect(calls).toEqual([[{ enabled: true }, { enabled: false }, { enabled: true }]])
  })

  it('keeps a newer Turn On that succeeded when an older Turn Off fails late', async () => {
    const cli = heldReplies()
    const { adapter, turnOn, turnOff, state } = await chat({ reply: cli.reply })
    await turnOn()
    cli.hold()

    const off = turnOff().catch(() => null)
    const on = turnOn()
    cli.answer(1).resolve({ session_url: 'https://claude.ai/code/session_02' })
    await on
    cli.answer(0).reject(new Error('remote_control timed out'))
    await off

    await expect(state()).resolves.toEqual({
      enabled: true,
      sessionUrl: 'https://claude.ai/code/session_02'
    })
    await expect(adapter.confirmIdle('session-1')).resolves.toBe('busy')
  })

  it('keeps a newer Turn Off that failed when an older Turn On succeeds late', async () => {
    const cli = heldReplies()
    const { adapter, turnOn, turnOff, state } = await chat({ reply: cli.reply })
    cli.hold()

    const on = turnOn()
    const off = turnOff().catch(() => null)
    cli.answer(1).reject(new Error('remote_control timed out'))
    await off
    cli.answer(0).resolve({ session_url: 'https://claude.ai/code/session_01' })
    await on

    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
    expect(adapter.confirmIdle('session-1')).toBeUndefined()
  })

  it('reads off and lets the idle stop run when the latest request fails', async () => {
    const cli = heldReplies()
    const { adapter, turnOn, state } = await chat({ reply: cli.reply })
    await turnOn()
    cli.hold()

    const again = turnOn().catch(() => null)
    cli.answer(0).reject(new Error('Remote Control is disabled by your organization'))
    await again

    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
    expect(adapter.confirmIdle('session-1')).toBeUndefined()
  })

  it('stays off after a restart while its Turn Off is still in flight', async () => {
    const cli = heldReplies()
    const { adapter, calls, start, turnOff } = await chat({
      initialization: { remote_control_auto_enable: true },
      reply: cli.reply
    })
    cli.hold()
    void turnOff().catch(() => null)
    await adapter.closeSession('session-1')

    await start(8)

    expect(calls).toEqual([[{ enabled: true }, { enabled: false }], []])
  })

  it("ignores an old process's late answer after the chat restarted", async () => {
    let first = true
    const late = Promise.withResolvers<unknown>()
    const { adapter, calls, start, turnOn } = await chat({
      reply: () => {
        if (!first) {
          return undefined
        }
        first = false
        return late.promise
      }
    })
    const on = turnOn()
    await adapter.closeSession('session-1')
    await start(8)
    late.resolve({ session_url: 'https://claude.ai/code/old', bridge_session_id: 'old' })
    await on
    await adapter.closeSession('session-1')

    await start(9)

    expect(calls.map((process) => process.at(-1))).toEqual([
      { enabled: true },
      { enabled: true },
      { enabled: true, reattachSessionId: 'session_01' }
    ])
  })

  it('leaves Remote Control off for a resumed chat even with the new-chat setting on', async () => {
    const { calls, state } = await chat({ newChats: true, resumed: true })

    expect(calls).toEqual([[]])
    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
  })

  it('adds no row and no turn for an unclaimed replay while Remote Control is off', async () => {
    const { frame, userRows, runningTurnsOn } = await chat()

    frame(REMOTE_PROMPT)

    expect([userRows('remote-prompt-1'), runningTurnsOn('remote-prompt-1')]).toEqual([[], []])
  })

  it('adds no row for an echo settled before Remote Control turned on', async () => {
    const { adapter, frame, turnOn, userRows } = await chat()
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-turn-1',
      body: USER_MESSAGE,
      fence: 7
    })
    await turnOn()

    frame({ ...REMOTE_PROMPT, uuid: 'user-uuid-0' })

    expect(userRows('user-uuid-0')).toEqual([])
  })

  it('adds no row for an echo settled before a Turn Off and Turn On', async () => {
    const { adapter, frame, turnOn, turnOff, userRows } = await chat()
    await turnOn()
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-turn-1',
      body: USER_MESSAGE,
      fence: 7
    })
    await turnOff()
    await turnOn()

    frame({ ...REMOTE_PROMPT, uuid: 'user-uuid-0' })

    expect(userRows('user-uuid-0')).toEqual([])
  })

  it.each(['failed', 'policy_disabled'])(
    'reads off and lets the idle stop run after the bridge reports %s',
    async (bridgeState) => {
      const { adapter, frame, turnOn, state } = await chat()
      await turnOn()

      frame({ type: 'system', subtype: 'bridge_state', state: bridgeState, uuid: 'bridge-1' })

      await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
      expect(adapter.confirmIdle('session-1')).toBeUndefined()
    }
  )

  it('keeps the chat working and logs it when Claude refuses Remote Control at start', async () => {
    const { adapter, claude, calls, warnings, state } = await chat({
      newChats: true,
      reply: () => Promise.reject(new Error('Remote Control is disabled by your organization'))
    })
    await tick()

    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-turn-1',
      body: USER_MESSAGE,
      fence: 7
    })

    expect(calls).toEqual([[{ enabled: true }]])
    expect(warnings).toEqual(['turning on Claude Remote Control failed'])
    expect(claudeWasSent(claude.connections[0]!, 'ship it')).toBe(true)
    await expect(state()).resolves.toEqual({ enabled: false, sessionUrl: null })
  })

  it('does not show the Stop marker as a prompt from claude.ai', async () => {
    const { frame, turnOn, userRows, runningTurnsOn } = await chat()
    await turnOn()

    frame({ ...STOP_MARKER, session_id: PROVIDER_SESSION_ID })

    const uuid = String(STOP_MARKER.uuid)
    expect([userRows(uuid), runningTurnsOn(uuid)]).toEqual([[], []])
  })

  it.each(['peer', 'channel'])(
    'does not show a %s message as a prompt from claude.ai',
    async (kind) => {
      const { frame, turnOn, userRows } = await chat()
      await turnOn()

      frame({ ...REMOTE_PROMPT, origin: { kind, from: 'other', server: 'other' } })

      expect(userRows('remote-prompt-1')).toEqual([])
    }
  )

  it('adds a folded prompt from claude.ai to the running turn, without a new turn', async () => {
    const { adapter, frame, turnOn, scopes, userRows, runningTurnsOn } = await chat()
    await turnOn()
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-turn-1',
      body: USER_MESSAGE,
      fence: 7
    })

    frame(REMOTE_PROMPT)

    expect(userRows('remote-prompt-1')).toHaveLength(1)
    expect(scopes.get('remote-prompt-1')).toEqual({
      kind: 'turn',
      turnItemId: expect.stringContaining('user-uuid-0')
    })
    expect(runningTurnsOn('remote-prompt-1')).toEqual([])
  })

  it('adds no prompt row for a repeated echo', async () => {
    const { adapter, frame, turnOn, userRows, runningTurnsOn } = await chat()
    await turnOn()
    await adapter.dispatch({
      sessionId: 'session-1',
      clientMessageId: 'client-turn-1',
      body: USER_MESSAGE,
      fence: 7
    })
    frame({ type: 'result', subtype: 'success', uuid: 'result-1', is_error: false })

    frame({ ...REMOTE_PROMPT, uuid: 'user-uuid-0' })
    frame(REMOTE_PROMPT)
    frame({ type: 'result', subtype: 'success', uuid: 'result-2', is_error: false })
    frame(REMOTE_PROMPT)

    expect([userRows('user-uuid-0'), runningTurnsOn('remote-prompt-1')]).toEqual([
      [],
      [expect.objectContaining({ body: expect.objectContaining({ kind: 'turn' }) })]
    ])
  })
})
