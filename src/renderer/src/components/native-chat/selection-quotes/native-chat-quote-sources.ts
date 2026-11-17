// Where a quote came from. Only this window keeps it; the agent never gets it.
const STORAGE_KEY = 'orca.nativeChat.quoteSources.v1'
const LIMIT = 200

type Entry = [key: string, messageId: string]
let entries: Entry[] | null = null

// Whitespace differs between a selection and the same text in the sent bubble; the characters do not.
const quoteKey = (text: string): string => text.replace(/\s+/g, '')

function load(): Entry[] {
  if (entries) {
    return entries
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    entries = Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is Entry =>
            Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'
        )
      : []
  } catch {
    entries = []
  }
  return entries
}

/** Remembers the chat message that "Add to chat" quoted `text` from. */
export function rememberNativeChatQuoteSource(text: string, messageId: string): void {
  const key = quoteKey(text)
  if (!key) {
    return
  }
  const entry: Entry = [key, messageId]
  entries = [...load().filter(([known]) => known !== key), entry].slice(-LIMIT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Without storage the source holds until the window reloads.
  }
}

export function nativeChatQuoteMessageId(text: string): string | null {
  const key = quoteKey(text)
  return load().find(([known]) => known === key)?.[1] ?? null
}

export function forgetNativeChatQuoteSourcesForTests(): void {
  entries = null
}

export type QuotedFileLocation = { pathText: string; line: number }

/** `path:12` or `path:12-20`: the first line of an editor or Markdown preview quote. */
export function quotedFileLocation(firstLine: string): QuotedFileLocation | null {
  const match = /^(\S.*):(\d+)(?:-\d+)?$/.exec(firstLine.trim())
  return match ? { pathText: match[1], line: Number(match[2]) } : null
}

export type NativeChatQuoteJumpDeps = {
  /** Shows the message in this transcript and highlights the text; false when it is not here. */
  jumpToMessage: ((messageId: string, text: string) => boolean) | null
  /** Opens the file at the line and highlights it; false when the chat cannot open it. */
  openFile: ((location: QuotedFileLocation) => boolean) | null
  notifyMissing: () => void
}

/** Goes back to where a sent quote came from: its chat message, else its file, else a notice. */
export function jumpToQuoteSource(
  text: string,
  firstLine: string,
  deps: NativeChatQuoteJumpDeps
): 'message' | 'file' | 'missing' {
  const messageId = nativeChatQuoteMessageId(text)
  if (messageId && deps.jumpToMessage?.(messageId, text)) {
    return 'message'
  }
  const location = quotedFileLocation(firstLine)
  if (location && deps.openFile?.(location)) {
    return 'file'
  }
  deps.notifyMissing()
  return 'missing'
}
