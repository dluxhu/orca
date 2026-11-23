import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { readRuntimeStatuses } from '@/store/slices/runtime-status/views/runtime-status-owner'
import { runtimeTargetForInstallation } from '@/runtime/hosts/selection/runtime-target-for-installation'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  structuredSessionOpenFeedbackText,
  type StructuredSessionOpenFeedback
} from './activate-ai-vault-structured-session'
import { openOrchestrationDispatch } from './open-agent-message-sender'

// A link that cannot open says so in a short notice, not as an error.
const notice: StructuredSessionOpenFeedback = {
  unavailable: () => toast.info(structuredSessionOpenFeedbackText.unavailable()),
  gone: () => toast.info(structuredSessionOpenFeedbackText.gone()),
  hostCannotOpen: () => toast.info(structuredSessionOpenFeedbackText.hostCannotOpen()),
  notLocated: (agent) => toast.info(structuredSessionOpenFeedbackText.notLocated(agent))
}

/** Opens a chat or terminal by its address on the host this window reaches it through. */
export function openOrcaAddress(
  host: RuntimeClientTarget,
  address: string,
  label: string
): Promise<void> {
  return openOrchestrationDispatch(address, label, host, { open: notice })
}

/** Opens a chat or terminal by its address on the Orca with this installation id. */
export async function openOnOrcaHost(
  installationId: string,
  address: string,
  label: string
): Promise<void> {
  const host = runtimeTargetForInstallation(
    useAppStore.getState(),
    readRuntimeStatuses(),
    installationId
  )
  if (!host) {
    toast.info(
      translate(
        'components.native-chat.agentMessage.hostNotConnected',
        '{{name}} is on a host this window is not connected to.',
        { name: label }
      )
    )
    return
  }
  await openOrcaAddress(host, address, label)
}
