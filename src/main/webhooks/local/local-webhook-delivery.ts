// A call the local listener admitted, handed to this host's webhooks as Orca Cloud's trigger delivery
// would be, so the ledger, the call file, the start slots, dedupe and Grace all run as for a cloud call.
import {
  automationWebhookTrigger,
  type AutomationRunEvent
} from '../../../shared/automation-event-triggers'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { Bot } from '../../../shared/bot-types'
import type { ConnectorDelivery } from '../../../shared/connectors/connector-cloud-contract'
import { hookIdOfRule, webhookActorId } from '../../../shared/connector-webhook-contract'
import type { WebhookEnvelope } from '../../../shared/connector-webhook-routes'
import { triggerRunEvent } from '../../connector-cloud/connector-triggers'
import type { LocalCall, LocalHook, LocalWebhookStore } from './local-webhook-store'

export type TriggerDelivery = Extract<ConnectorDelivery, { kind: 'trigger' }>

const DAY_MS = 24 * 60 * 60 * 1000

export type LocalWebhookDeliverDeps = {
  store: LocalWebhookStore
  automations: () => readonly Automation[]
  bots: () => readonly Pick<Bot, 'id'>[]
  receive: (delivery: TriggerDelivery, event: AutomationRunEvent) => boolean
}

/** The automation that lists the hook's rule here, with that rule. */
export function hookAutomation(automations: readonly Automation[], hook: LocalHook) {
  for (const automation of automations) {
    const rule = automationWebhookTrigger(automation)
    if (rule && hookIdOfRule(rule.id) === hook.hookId && automation.bot?.botId === hook.botId) {
      return { automation, rule }
    }
  }
  return null
}

/** Hands an admitted call to this host's webhooks; refused when no rule here takes it. */
export async function deliverLocalCall(
  deps: LocalWebhookDeliverDeps,
  hook: LocalHook,
  call: LocalCall
): Promise<void> {
  const automations = deps.automations()
  const found = hookAutomation(automations, hook)
  const delivery: TriggerDelivery | null = found && {
    kind: 'trigger',
    deliveryId: call.callId,
    expiresAt: call.receivedAt + DAY_MS,
    conversation: { source: 'webhook', externalId: hook.hookId },
    automationId: found.automation.id,
    triggerId: found.rule.id,
    botId: hook.botId,
    event: {
      key: call.callId,
      actorId: webhookActorId(hook.hookId),
      ...(call.subject === undefined ? {} : { subject: call.subject }),
      occurredAt: call.receivedAt,
      webhook: {
        callId: call.callId,
        epoch: hook.epoch,
        ...(call.sample ? { sample: true as const } : {})
      }
    }
  }
  const event = delivery && triggerRunEvent(automations, deps.bots(), delivery)
  const taken = delivery !== null && event !== null && deps.receive(delivery, event)
  // The host may already have started it; only a call still queued here changes.
  if (call.state === 'queued') {
    await deps.store.settle(
      call,
      taken ? 'delivered' : 'refused',
      taken ? undefined : 'automation_not_listening'
    )
  }
}

/** The body as a call's envelope keeps it, or null when its JSON doesn't parse. */
export function parseWebhookBody(
  contentType: string | null,
  text: string
): WebhookEnvelope['body'] | null {
  const media = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (text !== '' && (media === 'application/json' || media.endsWith('+json'))) {
    try {
      const value: unknown = JSON.parse(text)
      return { kind: 'json', value }
    } catch {
      return null
    }
  }
  if (media === 'application/x-www-form-urlencoded') {
    const value: Record<string, string | string[]> = {}
    for (const [key, entry] of new URLSearchParams(text)) {
      const seen = value[key]
      value[key] = seen === undefined ? entry : [...(Array.isArray(seen) ? seen : [seen]), entry]
    }
    return { kind: 'form', value }
  }
  return { kind: 'text', value: text }
}
