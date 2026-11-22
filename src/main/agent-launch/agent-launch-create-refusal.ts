import type { AgentLaunchIntent } from '../../shared/agent-launch/contracts/agent-launch-intent'
import type { AgentSessionAnyRefusalDetails } from '../../shared/agent-session/failures/agent-session-refusal-details'
import { AgentLaunchStructuredSessionRefusedError } from './agent-launch-surface-factories'
import { AgentLaunchSurfaceUnavailableError } from './agent-launch-surface-refusal'

/** A chat create refused before attach in an existing workspace started nothing: report that refusal, not an unknown outcome. */
export function launchRefusalWithoutEffects(
  error: unknown,
  targetKind: AgentLaunchIntent['target']['kind']
): unknown {
  if (
    !(error instanceof AgentLaunchStructuredSessionRefusedError) ||
    !error.beforeCommit ||
    targetKind !== 'existing'
  ) {
    return error
  }
  const { code, details } = error
  return new AgentLaunchSurfaceUnavailableError(
    `${error.message} (${refusalCause(code, details)})`,
    undefined,
    details ? { refusal: { code, details } } : undefined
  )
}

/** The code, then the reason and the chat that holds the conversation when the refusal names them. */
function refusalCause(code: string, details?: AgentSessionAnyRefusalDetails): string {
  const owner = details && 'owner' in details ? details.owner : undefined
  return [code, details?.reason, owner && `held by chat ${owner.sessionId}`]
    .filter(Boolean)
    .join(', ')
}
