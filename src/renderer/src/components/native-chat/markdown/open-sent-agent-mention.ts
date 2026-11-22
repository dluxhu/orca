import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { openOrchestrationDispatch } from '@/lib/agent-session/open/open-agent-message-sender'
import {
  structuredSessionOpenFeedbackText,
  type StructuredSessionOpenFeedback
} from '@/lib/agent-session/open/activate-ai-vault-structured-session'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { SentAgentMention } from '../../../../../shared/orchestration/mailbox/orchestration-agent-reference'

// A mention that cannot open says so in a short notice, not as an error.
const notice: StructuredSessionOpenFeedback = {
  unavailable: () => toast.info(structuredSessionOpenFeedbackText.unavailable()),
  gone: () => toast.info(structuredSessionOpenFeedbackText.gone()),
  hostCannotOpen: () => toast.info(structuredSessionOpenFeedbackText.hostCannotOpen()),
  notLocated: (agent) => toast.info(structuredSessionOpenFeedbackText.notLocated(agent))
}

/** The host this window opens a mention on: the chat's own host, or its saved environment of that name. */
export function sentAgentMentionHost(
  mention: Pick<SentAgentMention, 'environment'>,
  chatHost: RuntimeClientTarget,
  environments: readonly { id: string; name: string }[]
): RuntimeClientTarget | null {
  if (!mention.environment) {
    return chatHost
  }
  // shortcut: only a local chat's environments are this window's own; a remote chat's saved
  // environment shows the notice. Upgrade when the note carries the host's identity.
  if (chatHost.kind !== 'local') {
    return null
  }
  const saved = environments.find((environment) => environment.name === mention.environment)
  return saved ? { kind: 'environment', environmentId: saved.id } : null
}

/** Opens the chat or terminal a sent message mentions. */
export async function openSentAgentMention(
  mention: SentAgentMention,
  chatHost: RuntimeClientTarget
): Promise<void> {
  const host = sentAgentMentionHost(mention, chatHost, useAppStore.getState().runtimeEnvironments)
  if (!host) {
    toast.info(
      translate(
        'components.native-chat.agentMessage.hostNotConnected',
        '{{name}} is on a host this window is not connected to.',
        { name: mention.label }
      )
    )
    return
  }
  await openOrchestrationDispatch(mention.address, mention.label, host, { open: notice })
}
