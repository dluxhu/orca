import { afterEach, describe, expect, it } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentJournalItemBody } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentJournalItemIdentity } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import type { StructuredAgentSessionEventSink } from '../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import { createClaudeControlSurface } from '../sdk-transport/claude-agent-sdk-control-requests'
import type { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import {
  PROVIDER_SESSION_ID,
  adapterFor,
  claudeFrame,
  fakeClaude,
  identityFor,
  tick
} from './claude-structured-session-test-support'

type RemoteControlCall = { enabled: boolean; reattachSessionId?: string }

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
    initialization?: Record<string, unknown>
    reply?: (call: RemoteControlCall) => Promise<unknown> | undefined
  } = {}
) {
  const calls: RemoteControlCall[][] = []
  const items: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => items.push({ identity, body }),
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
  const adapter = adapterFor(claude)
  Object.assign(adapter['deps'], { remoteControlForNewChats: () => options.newChats === true })
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
  return {
    adapter,
    claude,
    calls,
    items,
    start,
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

    const prompt = { provider: 'claude', sessionId: PROVIDER_SESSION_ID, uuid: 'remote-prompt-1' }
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
})
