import { parseOrcaSessionAddress } from '../../agent-session/identity/orca-session-address'
import { isTerminalHandle } from '../../terminal/terminal-handle-prefix'

/** `kind` marks an `@` mention of a chat or a terminal; absent marks an orchestration mailbox reference. */
export type OrchestrationAgentReference = {
  label: string
  address: string
  hostKey: string
  kind?: AgentReferenceKind
}

export type AgentReferenceKind = 'chat' | 'terminal'

export function isPublicOrchestrationAddress(address: string): boolean {
  return (
    /^(?:term_[a-zA-Z0-9_-]+|(?:dispatch|run):[a-zA-Z0-9_-]+)$/.test(address) ||
    parseOrcaSessionAddress(address) !== null
  )
}

export function printableAgentLabel(label: string): string {
  return [...label.replace(/[\r\n\u2028\u2029]/g, ' ')]
    .filter(
      (char) =>
        char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    )
    .join('')
}

// Every printed reference carries this; a draft without it holds no agent reference.
const AGENT_REFERENCE_MARK = ' (Orca agent '

export function mayHoldAgentReferences(text: string): boolean {
  return text.includes(AGENT_REFERENCE_MARK)
}

export function agentReferenceToken(reference: OrchestrationAgentReference): string {
  return `@${reference.label}${AGENT_REFERENCE_MARK}${reference.address})`
}

/** The routing line a sent message ends with, one per mentioned agent. */
export function agentReferenceNote(
  label: string,
  address: string,
  kind?: AgentReferenceKind | null
): string {
  const session = kind === 'chat' ? parseOrcaSessionAddress(address) : null
  if (session) {
    return `[Orca chat "${label}": session ${session} — send it a message with orca chat send --session ${session} --text <message>, and read its replies with orca chat read --session ${session}]`
  }
  if (kind === 'terminal' && isTerminalHandle(address)) {
    return `[Orca terminal "${label}": ${address} — send it input with orca terminal send --terminal ${address} --text <text> --enter, and read its output with orca terminal read --terminal ${address}]`
  }
  return `[Orca agent "${label}": ${address} — message it with orca orchestration send --to ${address} --subject "<topic>" --body "<message>"]`
}

export function terminalAgentReference(reference: OrchestrationAgentReference): string | null {
  return isPublicOrchestrationAddress(reference.address)
    ? `${printableAgentLabel(reference.label)}${AGENT_REFERENCE_MARK}${reference.address}) `
    : null
}
