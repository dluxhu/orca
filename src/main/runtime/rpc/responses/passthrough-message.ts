import { formatTerminalStartFailure } from '../../../../shared/terminal/pty/lifecycle/terminal-start-failure'

/** The text of a coded passthrough error. An unknown outcome keeps its code; the text also names
 *  the coded refusal that caused it, so the caller sees why. */
export function passthroughMessage(error: unknown, code: string): string {
  const terminal = formatTerminalStartFailure(error)
  if (terminal) {
    return terminal
  }
  const cause = error instanceof Error ? error.cause : undefined
  return code === 'agent_session_operation_unknown' &&
    cause instanceof Error &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? `Orca could not confirm the launch outcome. The chat was refused: ${withCode(cause.message, cause.code)}`
    : code
}

function withCode(message: string, code: string): string {
  return message.includes(code) ? message : `${message} (${code})`
}
