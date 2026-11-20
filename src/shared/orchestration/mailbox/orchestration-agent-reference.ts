import { parseOrcaSessionAddress } from '../../orca-session-address'
import { isTerminalHandle } from '../../terminal-handle-prefix'

/** `kind` marks an `@` mention of a chat, a terminal agent or a plain shell; absent marks an orchestration mailbox reference. */
export type OrchestrationAgentReference = {
  label: string
  address: string
  hostKey: string
  kind?: AgentReferenceKind
  /** The saved environment that reaches a mentioned chat or terminal on another host. */
  environment?: string
}

/** `terminal` is a terminal with an agent in it; `shell` is a terminal with none. */
export type AgentReferenceKind = 'chat' | 'terminal' | 'shell'

export function isAgentReferenceKind(value: unknown): value is AgentReferenceKind {
  return value === 'chat' || value === 'terminal' || value === 'shell'
}

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

// A plain name stays bare; any other name is one single-quoted shell word.
function shellWord(value: string): string {
  return /^[\w.@:+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** The routing line a sent message ends with, one per mentioned agent. A chat or a terminal agent
 *  gets Orca mail, as a bot does. A chat shows the mail as a card from the sender. A plain shell reads
 *  no mail, so it gets typed input. `environment` names the host of a session on another host. */
export function agentReferenceNote(
  label: string,
  address: string,
  kind?: AgentReferenceKind | null,
  environment?: string | null
): string {
  const name = environment ? printableAgentLabel(environment) : ''
  // Shell quotes do not stop the CLI from reading a leading `-` as a flag; `--flag=value` does.
  const host = (flag: string) =>
    name ? ` --${flag}${name.startsWith('-') ? '=' : ' '}${shellWord(name)}` : ''
  if (kind === 'shell' && isTerminalHandle(address)) {
    return `[Orca terminal "${label}": ${address} — send it input with orca terminal send${host('environment')} --terminal ${address} --text <text> --enter, and read its output with orca terminal read${host('environment')} --terminal ${address}]`
  }
  // `--on` carries mail to a paired host; its replies come back here.
  const mail = `message it with orca orchestration send${host('on')} --to ${address}`
  if (kind === 'chat' || kind === 'terminal') {
    return `[Orca ${kind} "${label}": ${address} — ${mail} --subject "<topic>" --body "<message>"]`
  }
  return `[Orca agent "${label}": ${address} — ${mail}]`
}

export function terminalAgentReference(reference: OrchestrationAgentReference): string | null {
  return isPublicOrchestrationAddress(reference.address)
    ? `${printableAgentLabel(reference.label)}${AGENT_REFERENCE_MARK}${reference.address}) `
    : null
}
