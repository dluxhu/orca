// This host's own webhooks, for local webhooks: hooks, keys and calls in an owner-only file under
// userData, each call's envelope in its own file. It answers what Orca Cloud keeps for a hook.
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type * as z from 'zod'
import type { WebhookCallState } from '../../../shared/connector-webhook-contract'
import {
  WebhookEnvelope,
  type WebhookCallRow as WebhookCallRowSchema,
  type WebhookView
} from '../../../shared/connector-webhook-routes'
import { isMissingFileError } from '../../runtime/rpc/server/pairing/device-registry-corruption'
import {
  StoredLocalWebhooks,
  keyMatches,
  newCallId,
  newHookId,
  newWebhookKey,
  writeOwnerOnlyFile,
  type LocalCall,
  type LocalCounterKind,
  type LocalHook
} from './local-webhook-records'

export type { LocalCall, LocalHook } from './local-webhook-records'

type WebhookCallRow = z.infer<typeof WebhookCallRowSchema>

const DIR = 'local-webhooks'
const FILE = 'hooks.json'
const ENVELOPES = 'envelopes'

const DAY_MS = 24 * 60 * 60 * 1000
// A rotated key keeps working this long unless the rotation stops it now.
const PREVIOUS_KEY_MS = DAY_MS
// A sender's delivery id is remembered this long, so its resend is dropped.
const REPLAY_MS = DAY_MS
const CALLS_PER_HOOK = 200
const ENVELOPES_PER_HOOK = 50
const COUNTER_MS = 7 * DAY_MS

const PENDING: readonly WebhookCallState[] = ['queued', 'delivered']
const isPending = (call: LocalCall) => PENDING.includes(call.state) && !call.runId
const unreadable = () =>
  console.warn('[webhooks] the local webhook file was unreadable; starting a new one')

export class LocalWebhookStore {
  private loaded: Promise<StoredLocalWebhooks> | null = null
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly userDataPath: string,
    private readonly now: () => number = Date.now
  ) {}

  private get dir(): string {
    return join(this.userDataPath, DIR)
  }

  private envelopePath(callId: string): string {
    return join(this.dir, ENVELOPES, `${callId}.json`)
  }

  private async load(): Promise<StoredLocalWebhooks> {
    try {
      const parsed = StoredLocalWebhooks.safeParse(
        JSON.parse(await readFile(join(this.dir, FILE), 'utf8'))
      )
      if (parsed.success) {
        return parsed.data
      }
      unreadable()
    } catch (error) {
      if (!isMissingFileError(error)) {
        unreadable()
      }
    }
    return { hooks: [], calls: [], counters: [], deliveries: [] }
  }

  private data(): Promise<StoredLocalWebhooks> {
    return (this.loaded ??= this.load())
  }

  /** Writes in order, each with what memory held when it was asked for. */
  private async save(data: StoredLocalWebhooks): Promise<void> {
    const file = [join(this.dir, FILE), JSON.stringify(data)] as const
    const write = this.writes.then(() => writeOwnerOnlyFile(...file))
    this.writes = write.catch(() => {})
    await write
  }

  async hooks(botId?: string): Promise<LocalHook[]> {
    return (await this.data()).hooks.filter((hook) => botId === undefined || hook.botId === botId)
  }

  async hook(hookId: string): Promise<LocalHook | undefined> {
    return (await this.data()).hooks.find((hook) => hook.hookId === hookId)
  }

  async call(callId: string): Promise<LocalCall | undefined> {
    return (await this.data()).calls.find((call) => call.callId === callId)
  }

  /** The hook a key opens; an unknown hook and a wrong key are the same null. */
  async authenticate(hookId: string, key: string): Promise<LocalHook | null> {
    const hook = await this.hook(hookId)
    // An unknown hook still compares once, so its answer takes as long as a wrong key's.
    const current = keyMatches(key, hook?.key ?? newWebhookKey())
    const previous =
      hook?.previousKey !== undefined &&
      (hook.previousKeyExpiresAt ?? 0) > this.now() &&
      keyMatches(key, hook.previousKey)
    return hook && (current || previous) ? hook : null
  }

  /** The hook a create made; a repeat with the same operationId gets the same hook. */
  async mint(operationId: string, automationId: string, botId: string): Promise<LocalHook> {
    const data = await this.data()
    const made = data.hooks.find((hook) => hook.mintOperationId === operationId)
    if (made) {
      return made
    }
    const hook: LocalHook = {
      hookId: newHookId(),
      automationId,
      botId,
      state: 'live',
      epoch: 1,
      keyGeneration: 1,
      key: newWebhookKey(),
      previousKeyExpiresAt: null,
      mintOperationId: operationId,
      lastCall: null
    }
    data.hooks.push(hook)
    await this.save(data)
    return hook
  }

  /** A pause cancels the calls not yet started, as Orca Cloud does, and raises the hook's epoch. */
  async setState(hook: LocalHook, state: LocalHook['state']): Promise<void> {
    if (hook.state === state) {
      return
    }
    const data = await this.data()
    hook.state = state
    if (state === 'paused') {
      hook.epoch++
      await this.cancelPending(data, hook.hookId)
    }
    await this.save(data)
  }

  async remove(hookId: string): Promise<void> {
    const data = await this.data()
    for (const call of data.calls.filter((entry) => entry.hookId === hookId)) {
      await this.dropEnvelope(call)
    }
    data.hooks = data.hooks.filter((hook) => hook.hookId !== hookId)
    data.calls = data.calls.filter((call) => call.hookId !== hookId)
    data.counters = data.counters.filter((counter) => counter.hookId !== hookId)
    data.deliveries = data.deliveries.filter((entry) => entry.hookId !== hookId)
    await this.save(data)
  }

  /** A new key; the old one keeps working a day, or stops now with the calls it let in. */
  async rotate(hook: LocalHook, operationId: string, stopNow: boolean): Promise<number> {
    if (hook.rotateOperationId === operationId) {
      return hook.rotateCancelled ?? 0
    }
    const data = await this.data()
    const cancelled = stopNow ? await this.cancelPending(data, hook.hookId) : 0
    if (stopNow) {
      delete hook.previousKey
    } else {
      hook.previousKey = hook.key
    }
    hook.previousKeyExpiresAt = stopNow ? null : this.now() + PREVIOUS_KEY_MS
    hook.key = newWebhookKey()
    hook.keyGeneration++
    hook.rotateOperationId = operationId
    hook.rotateCancelled = cancelled
    await this.save(data)
    return cancelled
  }

  private async cancelPending(data: StoredLocalWebhooks, hookId: string): Promise<number> {
    const pending = data.calls.filter((call) => call.hookId === hookId && isPending(call))
    for (const call of pending) {
      call.state = 'cancelled'
      await this.dropEnvelope(call)
    }
    return pending.length
  }

  private async dropEnvelope(call: LocalCall): Promise<void> {
    if (call.hasEnvelope) {
      call.hasEnvelope = false
      await rm(this.envelopePath(call.callId), { force: true })
    }
  }

  /** Whether the sender already delivered this id in the last day; remembers it if not. */
  async replayed(hookId: string, deliveryId: string): Promise<boolean> {
    const data = await this.data()
    const since = this.now() - REPLAY_MS
    data.deliveries = data.deliveries.filter((entry) => entry.at > since)
    if (data.deliveries.some((entry) => entry.hookId === hookId && entry.id === deliveryId)) {
      return true
    }
    data.deliveries.push({ hookId, id: deliveryId, at: this.now() })
    await this.save(data)
    return false
  }

  /** A refused, over-budget or duplicate request, counted per minute as the call history shows them. */
  async count(hookId: string, kind: LocalCounterKind): Promise<void> {
    const data = await this.data()
    const minute = Math.floor(this.now() / 60_000) * 60_000
    data.counters = data.counters.filter((counter) => counter.minute > this.now() - COUNTER_MS)
    const counter = data.counters.find(
      (entry) => entry.hookId === hookId && entry.kind === kind && entry.minute === minute
    )
    if (counter) {
      counter.count++
    } else {
      data.counters.push({ hookId, kind, minute, count: 1 })
    }
    await this.save(data)
  }

  /** A new call with its envelope (none for an ignored or paused one), newest kept within the caps. */
  async admit(
    hook: LocalHook,
    call: Omit<LocalCall, 'callId' | 'hookId' | 'hasEnvelope'>,
    envelope: WebhookEnvelope | null
  ): Promise<LocalCall> {
    const entry: LocalCall = {
      ...call,
      callId: newCallId(),
      hookId: hook.hookId,
      hasEnvelope: envelope !== null
    }
    if (envelope) {
      await writeOwnerOnlyFile(this.envelopePath(entry.callId), JSON.stringify(envelope))
    }
    const data = await this.data()
    data.calls.unshift(entry)
    hook.lastCall = { at: call.receivedAt, state: call.state }
    const own = data.calls.filter((other) => other.hookId === hook.hookId)
    for (const old of own.slice(ENVELOPES_PER_HOOK)) {
      await this.dropEnvelope(old)
    }
    const dropped = new Set(own.slice(CALLS_PER_HOOK))
    data.calls = data.calls.filter((other) => !dropped.has(other))
    await this.save(data)
    return entry
  }

  /** A call's state changed: delivered to the host, or refused by it. */
  async settle(call: LocalCall, state: WebhookCallState, reason?: string): Promise<void> {
    const data = await this.data()
    call.state = state
    if (reason) {
      call.reason = reason
    }
    const hook = data.hooks.find((entry) => entry.hookId === call.hookId)
    if (hook?.lastCall?.at === call.receivedAt) {
      hook.lastCall.state = state
    }
    await this.save(data)
  }

  /** The run start a call gets: once, for one run. */
  async start(call: LocalCall, runId: string): Promise<'started' | 'another_run' | 'settled'> {
    if (call.runId !== undefined) {
      return call.runId === runId ? 'started' : 'another_run'
    }
    if (!PENDING.includes(call.state)) {
      return 'settled'
    }
    call.runId = runId
    call.state = 'started'
    await this.save(await this.data())
    return 'started'
  }

  async envelope(callId: string): Promise<WebhookEnvelope | null> {
    const call = await this.call(callId)
    if (!call?.hasEnvelope) {
      return null
    }
    try {
      return WebhookEnvelope.parse(JSON.parse(await readFile(this.envelopePath(callId), 'utf8')))
    } catch {
      return null
    }
  }

  /** The hook's calls and counted requests, newest first. */
  async history(hookId: string): Promise<WebhookCallRow[]> {
    const data = await this.data()
    const calls = data.calls
      .filter((call) => call.hookId === hookId)
      .map((call): WebhookCallRow => ({
        kind: 'call',
        callId: call.callId,
        receivedAt: call.receivedAt,
        state: call.state,
        ...(call.sample ? { sample: true as const } : {}),
        ...(call.runId ? { runId: call.runId } : {}),
        ...(call.reason ? { reason: call.reason } : {})
      }))
    const counters = data.counters
      .filter((counter) => counter.hookId === hookId)
      .map(({ kind, minute, count }): WebhookCallRow => ({ kind, minute, count }))
    const at = (row: WebhookCallRow) => (row.kind === 'call' ? row.receivedAt : row.minute)
    return [...calls, ...counters].sort((a, b) => at(b) - at(a))
  }

  async view(hook: LocalHook, baseUrl: string): Promise<WebhookView> {
    const data = await this.data()
    const previousLive = hook.previousKey && (hook.previousKeyExpiresAt ?? 0) > this.now()
    return {
      hookId: hook.hookId,
      automationId: hook.automationId,
      botId: hook.botId,
      state: hook.state,
      epoch: hook.epoch,
      hostGen: 1,
      keyGeneration: hook.keyGeneration,
      url: `${baseUrl}/hooks/${hook.hookId}`,
      adapter: null,
      previousKeyExpiresAt: previousLive ? hook.previousKeyExpiresAt : null,
      lastCall: hook.lastCall ? { ...hook.lastCall, signatureValid: false } : null,
      pendingCalls: data.calls.filter((call) => call.hookId === hook.hookId && isPending(call))
        .length
    }
  }

  /** The sample call a Send sample made; a repeat with the same operationId gets the same call. */
  async sampleCall(operationId: string): Promise<LocalCall | undefined> {
    return (await this.data()).calls.find((call) => call.sampleOperationId === operationId)
  }
}
