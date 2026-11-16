import type { AgentLaunchIntent } from '../../shared/agent-launch/contracts/agent-launch-intent'
import { AgentLaunchStructuredSessionRefusedError } from './agent-launch-surface-factories'
import { AgentLaunchSurfaceUnavailableError } from './agent-launch-surface-refusal'

/** A chat create refused before attach in an existing workspace started nothing: report that refusal, not an unknown outcome. */
export function launchRefusalWithoutEffects(
  error: unknown,
  targetKind: AgentLaunchIntent['target']['kind']
): unknown {
  return error instanceof AgentLaunchStructuredSessionRefusedError &&
    error.beforeCommit &&
    targetKind === 'existing'
    ? new AgentLaunchSurfaceUnavailableError(error.message)
    : error
}
