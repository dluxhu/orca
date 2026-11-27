import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WEBHOOK_CALL_ID_PATTERN,
  WEBHOOK_HOOK_ID_PATTERN
} from '../../../shared/connector-webhook-contract'
import type { WebhookCloudCalls } from '../webhook-cloud-routes'
import { localWebhookCalls, switchedWebhookCalls } from './local-webhook-routes'
import { keyMatches } from './local-webhook-records'
import { LocalWebhookStore, type LocalCall } from './local-webhook-store'

const WEBHOOK_KEY_PATTERN = /^orcawh_[A-Za-z0-9_-]{43}$/

let dir: string
let now: number
let store: LocalWebhookStore
let baseUrl: string
let delivered: LocalCall[]
let routes: WebhookCloudCalls

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'local-webhook-routes-'))
  now = 1_800_000_000_000
  store = new LocalWebhookStore(dir, () => now)
  baseUrl = 'http://127.0.0.1:6790'
  delivered = []
  routes = localWebhookCalls({
    store,
    baseUrl: () => baseUrl,
    deliver: async (_hook, call) => {
      delivered.push(call)
    },
    now: () => now
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const value = async <T>(result: Promise<{ ok: true; value: T } | { ok: false } | null> | null) => {
  const answer = await result
  if (!answer?.ok) {
    throw new Error('refused')
  }
  return answer.value
}
const mint = () => value(routes.mint({ operationId: 'op-1', automationId: 'a-1', botId: 'b-1' }))

describe('local webhook routes', () => {
  it("mints Orca Cloud's id and key formats, once per operation, and keeps them across restarts", async () => {
    const hook = await mint()
    expect(hook.hookId).toMatch(WEBHOOK_HOOK_ID_PATTERN)
    expect(await mint()).toEqual(hook)
    const { key } = await value(routes.reveal(hook.hookId, {}))
    expect(key).toMatch(WEBHOOK_KEY_PATTERN)
    const reopened = new LocalWebhookStore(dir, () => now)
    expect((await reopened.authenticate(hook.hookId, key))?.hookId).toBe(hook.hookId)
    expect(await reopened.authenticate(hook.hookId, `${key}x`)).toBeNull()
  })

  it('shows the local URL, or the Public URL when one is set', async () => {
    const hook = await mint()
    expect(hook.url).toBe(`http://127.0.0.1:6790/hooks/${hook.hookId}`)
    baseUrl = 'https://hooks.example.net/orca'
    expect((await value(routes.get(hook.hookId))).url).toBe(
      `https://hooks.example.net/orca/hooks/${hook.hookId}`
    )
  })

  it('compares keys in constant time over their digests', () => {
    expect(keyMatches('orcawh_a', 'orcawh_a')).toBe(true)
    expect(keyMatches('orcawh_a', 'orcawh_b')).toBe(false)
    expect(keyMatches('short', 'a much longer key')).toBe(false)
  })

  it('keeps the old key a day after a rotation, or stops it now', async () => {
    const hook = await mint()
    const first = (await store.hook(hook.hookId))?.key ?? ''
    await value(routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: false }))
    const second = (await store.hook(hook.hookId))?.key ?? ''
    expect(second).not.toBe(first)
    expect(await store.authenticate(hook.hookId, first)).not.toBeNull()
    expect((await value(routes.get(hook.hookId))).keyGeneration).toBe(2)
    now += 25 * 60 * 60 * 1000
    expect(await store.authenticate(hook.hookId, first)).toBeNull()
    await value(routes.rotate(hook.hookId, { operationId: 'r-2', stopNow: true }))
    expect(await store.authenticate(hook.hookId, second)).toBeNull()
  })

  it('grants one start per call, for one run', async () => {
    const hook = await mint()
    const { callId } = await value(routes.sample(hook.hookId, 'sample-1'))
    expect(callId).toMatch(WEBHOOK_CALL_ID_PATTERN)
    expect(delivered.map((call) => call.callId)).toEqual([callId])
    expect((await value(routes.sample(hook.hookId, 'sample-1'))).callId).toBe(callId)
    expect(await value(routes.envelope(callId))).toMatchObject({ body: { kind: 'json' } })
    expect(await value(routes.start(callId, 'run-1'))).toEqual({ started: true, runId: 'run-1' })
    expect(await value(routes.start(callId, 'run-1'))).toEqual({ started: true, runId: 'run-1' })
    expect(await routes.start(callId, 'run-2')).toMatchObject({
      ok: false,
      status: 409,
      error: 'started_for_another_run'
    })
    expect(await value(routes.calls(hook.hookId))).toEqual({
      calls: [
        { kind: 'call', callId, receivedAt: now, state: 'started', sample: true, runId: 'run-1' }
      ]
    })
  })

  it('rotates once for an operation, also for a repeat that overlaps it', async () => {
    const hook = await mint()
    const local = await store.hook(hook.hookId)
    if (!local) {
      throw new Error('no hook')
    }
    await Promise.all([
      routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: true }),
      routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: true })
    ])
    expect((await value(routes.get(hook.hookId))).keyGeneration).toBe(2)
  })

  it('fails an overlapping repeat with the rotation it repeats, and rotates on a later retry', async () => {
    const hook = await mint()
    await value(routes.sample(hook.hookId, 'sample-1'))
    const envelopes = join(dir, 'local-webhooks', 'envelopes')
    // The pending call's envelope can't be removed, so the stop-now cancellation fails.
    chmodSync(envelopes, 0o500)
    try {
      const tries = await Promise.allSettled([
        routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: true }),
        routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: true })
      ])
      expect(tries.map((entry) => entry.status)).toEqual(['rejected', 'rejected'])
    } finally {
      chmodSync(envelopes, 0o700)
    }
    expect((await value(routes.get(hook.hookId))).keyGeneration).toBe(1)
    expect(await value(routes.rotate(hook.hookId, { operationId: 'r-1', stopNow: true }))).toEqual({
      cancelledCalls: 1
    })
    expect((await value(routes.get(hook.hookId))).keyGeneration).toBe(2)
  })

  it('makes one sample per operation, and delivers it again if its delivery failed', async () => {
    const hook = await mint()
    let failures = 1
    const flaky = localWebhookCalls({
      store,
      baseUrl: () => baseUrl,
      deliver: async (_hook, call) => {
        if (failures-- > 0) {
          throw new Error('delivery failed')
        }
        delivered.push(call)
      },
      now: () => now
    })
    await expect(value(flaky.sample(hook.hookId, 's-1'))).rejects.toThrow('delivery failed')
    const [first, second] = await Promise.all([
      value(flaky.sample(hook.hookId, 's-1')),
      value(flaky.sample(hook.hookId, 's-1'))
    ])
    expect(second.callId).toBe(first.callId)
    expect(delivered.map((call) => call.callId)).toEqual([first.callId])
  })

  it('cancels calls not yet started when the hook pauses', async () => {
    const hook = await mint()
    const { callId } = await value(routes.sample(hook.hookId, 'sample-1'))
    const paused = await value(
      routes.setState(hook.hookId, { operationId: 'p-1', state: 'paused' })
    )
    expect(paused).toMatchObject({ state: 'paused', epoch: 2, pendingCalls: 0 })
    expect(await routes.envelope(callId)).toMatchObject({ ok: false, status: 404 })
    expect(await routes.start(callId, 'run-1')).toMatchObject({ ok: false, status: 410 })
  })

  it('refuses sender signatures, and forgets a removed hook', async () => {
    const hook = await mint()
    expect(
      await routes.setSecret(hook.hookId, { operationId: 's-1', adapter: 'github', generate: true })
    ).toMatchObject({ ok: false, status: 400 })
    await value(routes.remove(hook.hookId))
    expect(await routes.get(hook.hookId)).toMatchObject({ ok: false, status: 404 })
    expect(await value(routes.list('b-1'))).toEqual({ hooks: [] })
  })

  it('switches between the cloud routes and the local ones on every call', async () => {
    let local: WebhookCloudCalls | null = null
    const cloud = {
      ...routes,
      list: () => Promise.resolve({ ok: true as const, value: { hooks: [] } })
    }
    const switched = switchedWebhookCalls(cloud, () => local)
    await mint()
    expect(await value(switched.list('b-1'))).toEqual({ hooks: [] })
    local = routes
    expect((await value(switched.list('b-1'))).hooks).toHaveLength(1)
  })
})
