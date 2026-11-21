import { parseOrcaSessionAddress } from '../../orca-session-address'
import { isTerminalHandle } from '../../terminal-handle-prefix'

/** `kind` marks an `@` mention of a chat, a terminal agent or a plain shell; absent marks an orchestration mailbox reference. */
export type OrchestrationAgentReference = {
  label: string
  address: string
  hostKey: string
  kind?: AgentReferenceKind
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

/** The routing line a sent message ends with, one per mentioned agent. A chat or a terminal agent
 *  gets Orca mail, as a bot does. A chat shows the mail as a card from the sender. A plain shell reads
 *  no mail, so it gets typed input. */
export function agentReferenceNote(
  label: string,
  address: string,
  kind?: AgentReferenceKind | null
): string {
  if (kind === 'shell' && isTerminalHandle(address)) {
    return `[Orca terminal "${label}": ${address} — send it input with orca terminal send --terminal ${address} --text <text> --enter, and read its output with orca terminal read --terminal ${address}]`
  }
  const mail = `message it with orca orchestration send --to ${address}`
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

const NOTE_HEAD = /^\[Orca (agent|chat|terminal) "((?:[^"\\]|\\.)*)": (\S+) — /
const NOTE_KINDS: Record<string, readonly (AgentReferenceKind | null)[]> = {
  agent: [null],
  chat: ['chat'],
  terminal: ['terminal', 'shell']
}

export type SentAgentMention = { label: string; kind: AgentReferenceKind | null }

/** A sent message is its typed text, a blank line, and one routing note per mentioned agent.
 *  Gives the typed text and the mentions, or null when the text does not end in such notes. */
export function splitAgentReferenceNotes(
  text: string
): { body: string; mentions: SentAgentMention[] } | null {
  const end = text.lastIndexOf('\n\n')
  if (end === -1) {
    return null
  }
  const body = text.slice(0, end)
  const mentions: SentAgentMention[] = []
  for (const line of text.slice(end + 2).split('\n')) {
    const head = NOTE_HEAD.exec(line)
    // Only a note exactly as agentReferenceNote writes it, for a mention in the text, counts.
    const kinds = head
      ? NOTE_KINDS[head[1]].filter((kind) => agentReferenceNote(head[2], head[3], kind) === line)
      : []
    if (!head || kinds.length === 0 || !body.includes(`@${head[2]}`)) {
      return null
    }
    // The note escapes `\ " [ ]` as Markdown does; the shown label has no escapes.
    mentions.push({ label: head[2].replace(/\\(.)/g, '$1'), kind: kinds[0] })
  }
  return { body, mentions }
}
