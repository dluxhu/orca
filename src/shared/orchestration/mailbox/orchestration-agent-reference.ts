import { parseOrcaSessionAddress } from '../../agent-session/identity/orca-session-address'
import { isTerminalHandle } from '../../terminal/terminal-handle-prefix'

/** `kind` marks an `@` mention of a chat, a terminal agent or a plain shell; absent marks an orchestration mailbox reference. */
export type OrchestrationAgentReference = {
  label: string
  address: string
  hostKey: string
  kind?: AgentReferenceKind
  /** The saved environment that reaches a mentioned chat or terminal on another host. */
  environment?: string
  /** The agent's logo on its composer pill; never part of the sent text. */
  agentType?: string
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
  return `[Orca ${kind ?? 'agent'} "${label}": ${address} — ${mail} --subject "<topic>" --body "<message>"]`
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

// The host of a note for another host: a bare word or one single-quoted shell word.
const NOTE_HOST = / --(?:on|environment)[= ]([\w.@:+-]+|'(?:[^']|'\\'')*')/

/** `address` and `environment` are the note's: they open the mentioned session. */
export type SentAgentMention = {
  label: string
  kind: AgentReferenceKind | null
  address: string
  environment?: string
}

/** The mention of a note exactly as agentReferenceNote writes it, with the label as the note frames it. */
function noteMention(note: string): { framed: string; mention: SentAgentMention } | null {
  const head = NOTE_HEAD.exec(note)
  const word = head ? NOTE_HOST.exec(note.slice(head[0].length))?.[1] : undefined
  const environment = word?.startsWith("'") ? word.slice(1, -1).replaceAll(`'\\''`, "'") : word
  const kind = head
    ? NOTE_KINDS[head[1]].find(
        (candidate) => agentReferenceNote(head[2], head[3], candidate, environment) === note
      )
    : undefined
  if (!head || kind === undefined) {
    return null
  }
  // The note escapes `\ " [ ]` as Markdown does; the shown label has no escapes.
  return {
    framed: head[2],
    mention: {
      label: head[2].replace(/\\(.)/g, '$1'),
      kind,
      address: head[3],
      ...(environment ? { environment } : {})
    }
  }
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
