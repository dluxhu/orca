// This host's own webhooks, for local webhooks: hooks, keys and calls in an owner-only file under
// userData, each call's envelope in its own file. It answers what Orca Cloud keeps for a hook.
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebhookCallState } from '../../../shared/connector-webhook-contract'
import { WebhookEnvelope, type WebhookView } from '../../../shared/connector-webhook-routes'
import {
  type StoredLocalWebhooks,
  PENDING,
  counted,
  deliveryHash,
  historyRows,
  hookView,
  isPending,
  keyMatches,
  loadLocalWebhooks,
  newCallId,
  newHookId,
  newWebhookKey,
  shared,
  writeOwnerOnlyFile,
  type LocalCall,
  type LocalCounterKind,
  type LocalHook
} from './local-webhook-records'

export type { LocalCall, LocalHook } from './local-webhook-records'

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

export class LocalWebhookStore {
  private loaded: Promise<StoredLocalWebhooks> | null = null
  private writes: Promise<void> = Promise.resolve()
  private readonly rotations = new Map<string, Promise<number>>()
  private readonly mints = new Map<string, Promise<LocalHook>>()

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

  private data(): Promise<StoredLocalWebhooks> {
    // A failed read is not kept: the next access reads the file again.
    return (this.loaded ??= loadLocalWebhooks(join(this.dir, FILE)).catch((error: unknown) => {
      this.loaded = null
      throw error
    }))
  }

  /**
   * Writes in order, each with what memory held when it was asked for. A failed write drops memory,
   * so nothing a caller was refused is kept or later acknowledged; the next read loads the file.
   */
  private async save(data: StoredLocalWebhooks): Promise<void> {
    const file = [join(this.dir, FILE), JSON.stringify(data)] as const
    const write = this.writes.then(() => writeOwnerOnlyFile(...file))
    this.writes = write.catch(() => {
      this.loaded = null
    })
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
    return hook && (current || this.previousKeyOpens(hook, key)) ? hook : null
  }

  private previousKeyOpens(hook: LocalHook, key: string): boolean {
    return (
      hook.previousKey !== undefined &&
      (hook.previousKeyExpiresAt ?? 0) > this.now() &&
      keyMatches(key, hook.previousKey)
    )
  }

  /** Whether a call with this sender delivery id was taken in the last day. */
  async deliveryTaken(hookId: string, deliveryId: string): Promise<boolean> {
    const id = deliveryHash(deliveryId)
    const since = this.now() - REPLAY_MS
    return (await this.data()).deliveries.some(
      (entry) => entry.hookId === hookId && entry.id === id && entry.at > since
    )
  }

  /** Calls taken but never handed to the host's webhooks, e.g. when that failed or Orca quit. */
  async queued(): Promise<{ hook: LocalHook; call: LocalCall }[]> {
    const data = await this.data()
    return data.calls.flatMap((call) => {
      const hook = data.hooks.find((entry) => entry.hookId === call.hookId)
      return hook && call.state === 'queued' ? [{ hook, call }] : []
    })
  }

  /** A repeat while the first try is still writing waits for it, a failure included. */
  mint(operationId: string, automationId: string, botId: string): Promise<LocalHook> {
    return shared(this.mints, operationId, () => this.mintOnce(operationId, automationId, botId))
  }

  private async mintOnce(
    operationId: string,
    automationId: string,
    botId: string
  ): Promise<LocalHook> {
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
  rotate(hook: LocalHook, operationId: string, stopNow: boolean): Promise<number> {
    return shared(this.rotations, operationId, () => this.rotateOnce(hook, operationId, stopNow))
  }

  private async rotateOnce(
    hook: LocalHook,
    operationId: string,
    stopNow: boolean
  ): Promise<number> {
    if (hook.rotateOperationId === operationId) {
      return hook.rotateCancelled ?? 0
    }
    // The key changes before any await, so a repeat of this operation can't rotate it again.
    hook.rotateOperationId = operationId
    if (stopNow) {
      delete hook.previousKey
    } else {
      hook.previousKey = hook.key
    }
    hook.previousKeyExpiresAt = stopNow ? null : this.now() + PREVIOUS_KEY_MS
    hook.key = newWebhookKey()
    hook.keyGeneration++
    const data = await this.data()
    try {
      hook.rotateCancelled = stopNow ? await this.cancelPending(data, hook.hookId) : 0
    } catch (error) {
      // Unfinished: memory goes, so a retry rotates again from the file.
      this.loaded = null
      throw error
    }
    await this.save(data)
    return hook.rotateCancelled
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

  /** A refused, over-budget or duplicate request, counted per minute as the call history shows them. */
  async count(hookId: string, kind: LocalCounterKind): Promise<void> {
    const data = await this.data()
    data.counters = counted(data.counters, hookId, kind, this.now())
    await this.save(data)
  }

  /** A new call with its envelope (none for an ignored or paused one), newest kept within the caps. */
  async admit(
    hook: LocalHook,
    call: Omit<LocalCall, 'callId' | 'hookId' | 'hasEnvelope' | 'epoch'>,
    envelope: WebhookEnvelope | null,
    sender: { key?: string; deliveryId?: string } = {}
  ): Promise<LocalCall | null> {
    const entry: LocalCall = {
      ...call,
      callId: newCallId(),
      hookId: hook.hookId,
      epoch: hook.epoch,
      hasEnvelope: envelope !== null
    }
    if (envelope) {
      await writeOwnerOnlyFile(this.envelopePath(entry.callId), JSON.stringify(envelope))
    }
    const data = await this.data()
    // Checked with no await before the call is listed: a hook removed meanwhile, or a key a stop-now
    // rotation ended, refuses it; a rotation after this finds it to cancel.
    const current = data.hooks.find((entry) => entry.hookId === hook.hookId)
    const key = sender.key
    if (
      !current ||
      (key !== undefined && !keyMatches(key, current.key) && !this.previousKeyOpens(current, key))
    ) {
      await this.dropEnvelope(entry)
      return null
    }
    data.calls.unshift(entry)
    if (sender.deliveryId !== undefined) {
      // Saved with the call itself, so a resend is a duplicate exactly when its call was taken.
      data.deliveries = data.deliveries.filter((other) => other.at > call.receivedAt - REPLAY_MS)
      data.deliveries.push({
        hookId: hook.hookId,
        id: deliveryHash(sender.deliveryId),
        at: call.receivedAt
      })
    }
    current.lastCall = { at: call.receivedAt, state: call.state }
    const own = data.calls.filter((other) => other.hookId === hook.hookId)
    const stale = own.slice(ENVELOPES_PER_HOOK).filter((old) => old.hasEnvelope)
    for (const old of stale) {
      old.hasEnvelope = false
    }
    const dropped = new Set(own.slice(CALLS_PER_HOOK))
    data.calls = data.calls.filter((other) => !dropped.has(other))
    // A failed save drops memory (save), so a refused call is never visible afterwards.
    await this.save(data)
    // Only after the save: a leftover file is harmless, a half-taken call is not.
    await Promise.all(
      stale.map((old) => rm(this.envelopePath(old.callId), { force: true }).catch(() => {}))
    )
    return entry
  }

  /** A call's state changed: delivered to the host, or refused by it. */
  async settle(call: LocalCall, state: WebhookCallState, reason?: string): Promise<void> {
    // Before any await, so a run start that follows can't be overwritten by this change.
    call.state = state
    if (reason) {
      call.reason = reason
    }
    const data = await this.data()
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
  async history(hookId: string): Promise<ReturnType<typeof historyRows>> {
    const data = await this.data()
    const own = <T extends { hookId: string }>(rows: T[]) =>
      rows.filter((row) => row.hookId === hookId)
    return historyRows(own(data.calls), own(data.counters))
  }

  async view(hook: LocalHook, baseUrl: string): Promise<WebhookView> {
    const pending = (await this.data()).calls.filter(
      (c) => c.hookId === hook.hookId && isPending(c)
    )
    return hookView(hook, pending.length, baseUrl, this.now())
  }

  /** The sample call a Send sample made; a repeat with the same operationId gets the same call. */
  async sampleCall(operationId: string): Promise<LocalCall | undefined> {
    return (await this.data()).calls.find((call) => call.sampleOperationId === operationId)
  }
}
