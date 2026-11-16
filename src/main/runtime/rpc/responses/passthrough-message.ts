import { formatTerminalStartFailure } from '../../../../shared/terminal/pty/lifecycle/terminal-start-failure'
import { AgentLaunchStructuredSessionRefusedError } from '../../../agent-launch/agent-launch-surface-factories'

/** The text of a coded passthrough error. An unknown launch outcome caused by a chat create
 *  refusal names that refusal's code. Host words never cross the envelope. */
export function passthroughMessage(error: unknown, code: string): string {
  const terminal = formatTerminalStartFailure(error)
  if (terminal) {
    return terminal
  }
  const cause = error instanceof Error ? error.cause : undefined
  return code === 'agent_session_operation_unknown' &&
    cause instanceof AgentLaunchStructuredSessionRefusedError
    ? `Orca could not confirm the launch outcome. The chat create was refused (${cause.code}).`
    : code
}
