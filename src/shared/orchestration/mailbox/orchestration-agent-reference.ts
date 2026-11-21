import { parseOrcaSessionAddress } from '../../agent-session/identity/orca-session-address'
import { isTerminalHandle } from '../../terminal/terminal-handle-prefix'

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
  return `[Orca ${kind ?? 'agent'} "${label}": ${address} — message it with orca orchestration send --to ${address} --subject "<topic>" --body "<message>"]`
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

/** The mention of a note exactly as agentReferenceNote writes it, with the label as the note frames it. */
function noteMention(note: string): { framed: string; mention: SentAgentMention } | null {
  const head = NOTE_HEAD.exec(note)
  const kind = head
    ? NOTE_KINDS[head[1]].find(
        (candidate) => agentReferenceNote(head[2], head[3], candidate) === note
      )
    : undefined
  if (!head || kind === undefined) {
    return null
  }
  // The note escapes `\ " [ ]` as Markdown does; the shown label has no escapes.
  return { framed: head[2], mention: { label: head[2].replace(/\\(.)/g, '$1'), kind } }
}

/** A sent message is its typed text, then one routing note per mentioned agent: after a blank line
 *  and one per line, or, for a goal, on the same line after a space each. Gives the typed text and
 *  the mentions, or null when the text does not end in such notes for mentions in the text. */
export function splitAgentReferenceNotes(
  text: string,
  layout: 'message' | 'goal' = 'message'
): { body: string; mentions: SentAgentMention[] } | null {
  let start = text.length
  let notes: string[] = []
  if (layout === 'goal') {
    // A note frames `[` in its label, so ` [Orca ` starts a note and nothing in it.
    for (;;) {
      const at = text.lastIndexOf(' [Orca ', start - 1)
      if (at === -1 || !noteMention(text.slice(at + 1, start))) {
        break
      }
      notes.unshift(text.slice(at + 1, start))
      start = at
    }
  } else if (text.includes('\n\n')) {
    start = text.lastIndexOf('\n\n')
    notes = text.slice(start + 2).split('\n')
  }
  const body = text.slice(0, start)
  const mentions: SentAgentMention[] = []
  for (const note of notes) {
    const found = noteMention(note)
    if (!found || !body.includes(`@${found.framed}`)) {
      return null
    }
    mentions.push(found.mention)
  }
  return mentions.length > 0 ? { body, mentions } : null
}
