// The local webhook listener: POST <base>/hooks/<hookId>[/<key>], or the key as a Bearer token.
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  matchesWebhookCall,
  webhookBodyFits,
  webhookCallSubject
} from '../../../../cloud/packages/connector-contract/src/webhook-matcher'
import { WEBHOOK_HOOK_ID_PATTERN } from '../../../shared/connector-webhook-contract'
import type { WebhookEnvelope } from '../../../shared/connector-webhook-routes'
import { webhookCallView } from '../webhook-call-file'
import {
  deliverLocalCall,
  hookAutomation,
  parseWebhookBody,
  type LocalWebhookDeliverDeps
} from './local-webhook-delivery'

// As Orca Cloud's WEBHOOK_ENVELOPE_LIMITS (connector-contract/src/webhook-envelope.ts).
const MAX_HEADER_VALUE_LENGTH = 1024

export const LOCAL_WEBHOOK_LIMITS: {
  maxBodyBytes: number
  perHookPerMinute: number
  perMinute: number
} = { maxBodyBytes: 1024 * 1024, perHookPerMinute: 30, perMinute: 120 }

// Only these headers are kept with a call; Authorization, cookies and signatures never are.
const KEPT_HEADERS = [
  'content-type',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'x-github-hook-id',
  'idempotency-key',
  'x-request-id'
]
// A sender's own delivery id: a repeat of one is dropped for a day.
const DELIVERY_ID_HEADERS = ['x-github-delivery', 'idempotency-key']

const PATH = /^\/hooks\/([^/]+)(?:\/([^/]+))?\/?$/

/** Requests per minute, counted per key in fixed one-minute windows. */
class MinuteCounts {
  private readonly windows = new Map<string, { start: number; count: number }>()
  take(key: string, limit: number, now: number): boolean {
    const start = Math.floor(now / 60_000) * 60_000
    const window = this.windows.get(key)
    if (!window || window.start !== start) {
      this.windows.set(key, { start, count: 1 })
      return true
    }
    window.count++
    return window.count <= limit
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(JSON.stringify(body))
}

/** The body, or 'too_large' as soon as it passes the cap; nothing past the cap is kept. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) {
        return
      }
      size += chunk.length
      if (size > maxBytes) {
        done = true
        resolve('too_large')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!done) {
        done = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', (error) => {
      if (!done) {
        done = true
        reject(error)
      }
    })
  })
}

function bearerKey(req: IncomingMessage): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')
  return match?.[1] ?? null
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value.slice(0, MAX_HEADER_VALUE_LENGTH) : undefined
}

/** The path's hook id and key, or null for any other path. */
function hookPath(url: string | undefined): { hookId: string; key: string | null } | null {
  const match = PATH.exec(new URL(url ?? '/', 'http://local').pathname)
  if (!match) {
    return null
  }
  try {
    const key = match[2] === undefined ? null : decodeURIComponent(match[2])
    return { hookId: match[1] ?? '', key }
  } catch {
    return null
  }
}

export type LocalWebhookHandlerDeps = LocalWebhookDeliverDeps & {
  now?: () => number
  limits?: Partial<typeof LOCAL_WEBHOOK_LIMITS>
}

export function createLocalWebhookHandler(
  deps: LocalWebhookHandlerDeps
): (req: IncomingMessage, res: ServerResponse) => void {
  const now = deps.now ?? Date.now
  const limits = { ...LOCAL_WEBHOOK_LIMITS, ...deps.limits }
  const counts = new MinuteCounts()
  const notFound = (res: ServerResponse) => send(res, 404, { error: 'not_found' })
  const rateLimited = (res: ServerResponse) =>
    send(res, 429, { error: 'rate_limited' }, { 'retry-after': '60' })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = hookPath(req.url)
    if (!path) {
      notFound(res)
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' })
      return
    }
    if (!counts.take('*', limits.perMinute, now())) {
      rateLimited(res)
      return
    }
    const key = path.key ?? bearerKey(req)
    if (!key) {
      send(res, 401, { error: 'key_required' }, { 'www-authenticate': 'Bearer' })
      return
    }
    const hook = WEBHOOK_HOOK_ID_PATTERN.test(path.hookId)
      ? await deps.store.authenticate(path.hookId, key)
      : null
    if (!hook) {
      if (await deps.store.hook(path.hookId)) {
        await deps.store.count(path.hookId, 'refused')
      }
      notFound(res)
      return
    }
    if (!counts.take(hook.hookId, limits.perHookPerMinute, now())) {
      await deps.store.count(hook.hookId, 'over_budget')
      rateLimited(res)
      return
    }
    const tooLarge = () => {
      res.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
      // Stops reading the rest of an over-cap body once the answer is out.
      res.end(JSON.stringify({ error: 'body_too_large' }), () => req.destroy())
    }
    if (Number(req.headers['content-length'] ?? 0) > limits.maxBodyBytes) {
      tooLarge()
      return
    }
    const raw = await readBody(req, limits.maxBodyBytes)
    if (raw === 'too_large') {
      tooLarge()
      return
    }
    // The hook's own keys never reach the stored call, the run's file or its quote.
    let text = raw.toString('utf8')
    for (const own of [hook.key, hook.previousKey, key]) {
      text = own ? text.split(own).join('[orca webhook key]') : text
    }
    const contentType = headerValue(req, 'content-type') ?? null
    const body = parseWebhookBody(contentType, text)
    if (!body) {
      send(res, 400, { error: 'invalid_json' })
      return
    }
    if (!webhookBodyFits(body.value)) {
      send(res, 413, { error: 'body_too_complex' })
      return
    }
    const found = hookAutomation(deps.automations(), hook)
    if (!found) {
      notFound(res)
      return
    }
    const deliveryId = DELIVERY_ID_HEADERS.map((name) => headerValue(req, name)).find(Boolean)
    if (deliveryId && (await deps.store.replayed(hook.hookId, deliveryId))) {
      await deps.store.count(hook.hookId, 'duplicate')
      send(res, 200, { status: 'duplicate' })
      return
    }
    const headers = Object.fromEntries(
      KEPT_HEADERS.flatMap((name) => {
        const value = headerValue(req, name)
        return value === undefined ? [] : [[name, value]]
      })
    )
    const receivedAt = now()
    const envelope: WebhookEnvelope = { receivedAt, contentType, headers, body, truncated: false }
    const view = webhookCallView(envelope)
    if (hook.state === 'paused' || !found.automation.enabled) {
      const call = await deps.store.admit(hook, { receivedAt, state: 'paused' }, null)
      send(res, 200, { callId: call.callId, status: 'paused' })
      return
    }
    if (!matchesWebhookCall(found.rule, view)) {
      const call = await deps.store.admit(hook, { receivedAt, state: 'ignored' }, null)
      send(res, 200, { callId: call.callId, status: 'ignored' })
      return
    }
    const subject = webhookCallSubject(found.rule, view)
    const call = await deps.store.admit(
      hook,
      { receivedAt, state: 'queued', ...(subject === undefined ? {} : { subject }) },
      envelope
    )
    await deliverLocalCall(deps, hook, call)
    send(res, 200, { callId: call.callId, status: 'queued' })
  }

  return (req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.warn('[webhooks] a local webhook call failed', error)
      if (!res.headersSent) {
        send(res, 500, { error: 'internal' })
      } else {
        res.end()
      }
    })
  }
}
