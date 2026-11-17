// Where a quote came from. The app's windows on this computer share this list, and it stays after a
// restart. It holds a short hash of each quote, not its text. The agent never gets it.
const STORAGE_KEY = 'orca.nativeChat.quoteSources.v1'
const LIMIT = 200

type Entry = [key: string, messageId: string]

/**
 * The letters and digits of a quote, as a short hash and their count. Why: the sent bubble shows
 * the quote as Markdown, which drops whitespace, marks such as `#` and `-`, and list numbers.
 */
function quoteKey(text: string): string {
  const letters = text.replace(/^[ \t]*\d+[.)][ \t]/gm, '').replace(/[^\p{L}\p{N}]/gu, '')
  if (!letters) {
    return ''
  }
  // FNV-1a over UTF-16 code units: short, and stable between windows.
  let hash = 0x811c9dc5
  for (let index = 0; index < letters.length; index++) {
    hash = Math.imul(hash ^ letters.charCodeAt(index), 0x01000193)
  }
  return `${(hash >>> 0).toString(36)}:${letters.length}`
}

// Read on each use: another window can write between two calls.
function load(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is Entry =>
            Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'
        )
      : []
  } catch {
    return []
  }
}

/** Remembers the chat message that "Add to chat" quoted `text` from. */
export function rememberNativeChatQuoteSource(text: string, messageId: string): void {
  const key = quoteKey(text)
  if (!key) {
    return
  }
  const entry: Entry = [key, messageId]
  const entries = [...load().filter(([known]) => known !== key), entry].slice(-LIMIT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Without storage, the quote has no message source; its file header can still jump.
  }
}

export function nativeChatQuoteMessageId(text: string): string | null {
  const key = quoteKey(text)
  return key ? (load().find(([known]) => known === key)?.[1] ?? null) : null
}

export type QuotedFileLocation = { pathText: string; line: number }

/**
 * `path:12` or `path:12-20`: the first line of an editor or Markdown preview quote. A preview quote
 * with no source lines has only the path; it opens at line 1.
 */
export function quotedFileLocation(firstLine: string): QuotedFileLocation | null {
  const text = firstLine.trim()
  const lines = /^(\S.*):(\d+)(?:-\d+)?$/.exec(text)
  if (lines) {
    return { pathText: lines[1], line: Number(lines[2]) }
  }
  // shortcut: a terminal title that looks like a path opens as a file; keep the source kind if that matters.
  return /^[^\s:]*(?:\/|\.[A-Za-z0-9]+$)[^\s:]*$/.test(text) ? { pathText: text, line: 1 } : null
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
