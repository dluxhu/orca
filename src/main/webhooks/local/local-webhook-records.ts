// What the local webhook store keeps, the ids and keys it makes in Orca Cloud's formats, and how it writes.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as z from 'zod'
import {
  WEBHOOK_CALL_STATES,
  WEBHOOK_HOOK_ID_PATTERN
} from '../../../shared/connector-webhook-contract'

export const LocalHook = z.object({
  hookId: z.string().regex(WEBHOOK_HOOK_ID_PATTERN),
  automationId: z.string().min(1),
  botId: z.string().min(1),
  state: z.enum(['live', 'paused']),
  epoch: z.number().int().nonnegative(),
  keyGeneration: z.number().int().nonnegative(),
  key: z.string().min(1),
  previousKey: z.string().min(1).optional(),
  previousKeyExpiresAt: z.number().nullable(),
  mintOperationId: z.string().min(1),
  rotateOperationId: z.string().optional(),
  rotateCancelled: z.number().int().nonnegative().optional(),
  lastCall: z.object({ at: z.number(), state: z.enum(WEBHOOK_CALL_STATES) }).nullable()
})
export type LocalHook = z.infer<typeof LocalHook>

export const LocalCall = z.object({
  callId: z.string().min(1),
  hookId: z.string().min(1),
  receivedAt: z.number(),
  state: z.enum(WEBHOOK_CALL_STATES),
  subject: z.string().optional(),
  sample: z.literal(true).optional(),
  sampleOperationId: z.string().optional(),
  runId: z.string().optional(),
  reason: z.string().optional(),
  hasEnvelope: z.boolean()
})
export type LocalCall = z.infer<typeof LocalCall>

const Counter = z.object({
  hookId: z.string().min(1),
  kind: z.enum(['refused', 'over_budget', 'duplicate']),
  minute: z.number(),
  count: z.number().int().positive()
})
export type LocalCounterKind = z.infer<typeof Counter>['kind']

export const StoredLocalWebhooks = z.object({
  hooks: z.array(LocalHook),
  calls: z.array(LocalCall),
  counters: z.array(Counter),
  deliveries: z.array(z.object({ hookId: z.string(), id: z.string(), at: z.number() }))
})
export type StoredLocalWebhooks = z.infer<typeof StoredLocalWebhooks>

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Random letters and digits; 248 of 256 byte values are kept, so each is uniform. */
function randomAlphanumeric(length: number): string {
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) {
        out += ALPHANUMERIC[byte % ALPHANUMERIC.length]
      }
    }
  }
  return out
}

// The id and key formats Orca Cloud mints (cloud/packages/connector-contract/src/webhook-names.ts).
export const newHookId = (): string => `wh_${randomAlphanumeric(16)}`
export const newCallId = (): string => `call_${randomAlphanumeric(20)}`
export const newWebhookKey = (): string => `orcawh_${randomBytes(32).toString('base64url')}`

const digest = (text: string): Buffer => createHash('sha256').update(text).digest()

/** Whether `candidate` is `key`, in time that doesn't depend on where they differ. */
export function keyMatches(candidate: string, key: string): boolean {
  return timingSafeEqual(digest(candidate), digest(key))
}

/** Replaces the file whole, readable by this user only; a crash leaves the old file or the new one. */
export async function writeOwnerOnlyFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staged = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(staged, contents, { mode: 0o600, flag: 'wx' })
    await rename(staged, path)
  } finally {
    await rm(staged, { force: true })
  }
}
