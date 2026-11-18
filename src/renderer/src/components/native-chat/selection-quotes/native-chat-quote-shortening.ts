import { promptTextContent, QUOTE_NODE } from '../composer/editor/native-chat-prompt-document-text'
import { quotedText } from './native-chat-quote-selection'
import {
  nativeChatQuoteSource,
  quoteKey,
  rememberNativeChatQuoteSource
} from './native-chat-quote-sources'

/** A quote of an earlier reply goes to the agent shortened only when it is longer than this. */
export const QUOTE_SHORTEN_THRESHOLD = 400
const EDGE = 80

// Full quotes by the key of their short text, so that a sent bubble shows the full quote.
// In memory only: no quoted text goes to disk.
const fullQuotes = new Map<string, string>()

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** Up to `EDGE` characters, cut at a space where one is near. */
function head(text: string): string {
  if (text.length <= EDGE) {
    return text
  }
  const cut = text.slice(0, EDGE)
  const space = cut.lastIndexOf(' ')
  return space > EDGE / 2 ? cut.slice(0, space) : cut
}

function tail(text: string): string {
  if (text.length <= EDGE) {
    return text
  }
  const cut = text.slice(-EDGE)
  const space = cut.indexOf(' ')
  return space !== -1 && space < EDGE / 2 ? cut.slice(space + 1) : cut
}

/** The quote token in the short shape: the first sentence, how much is left out, the last one. */
export function shortenedQuoteToken(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim()
  const sentences = flat.split(/(?<=[.!?])\s+/)
  const first = head(sentences[0])
  const last = tail(sentences.at(-1)!)
  const omitted = words(flat.slice(first.length, flat.length - last.length))
  return [
    `> ${first} …`,
    `> (${omitted} quoted words left out; the full text is in your earlier reply)`,
    `> … ${last}`
  ]
    .join('\n')
    .concat('\n\n')
}

/**
 * The text for the agent: each long quote of a reply in this chat is in the short shape. The agent
 * has that reply already. The quote's recorded source tells if the reply is in this chat.
 */
export function shortenSameChatQuotes(
  text: string,
  chatMessages: readonly { id: string }[]
): string {
  const tokens = (promptTextContent(text).content ?? []).flatMap((paragraph) =>
    (paragraph.content ?? [])
      .filter((node) => node.type === QUOTE_NODE)
      .map((node) => String(node.attrs?.token ?? ''))
  )
  let result = ''
  let cursor = 0
  for (const token of tokens) {
    // A chip's token starts a line.
    let at = text.indexOf(token, cursor)
    while (at > 0 && text[at - 1] !== '\n') {
      at = text.indexOf(token, at + 1)
    }
    if (at === -1) {
      break
    }
    const quote = quotedText(token)
    const source = nativeChatQuoteSource(quote)
    let sent = token
    if (
      quote.length > QUOTE_SHORTEN_THRESHOLD &&
      source &&
      chatMessages.some((message) => message.id === source.messageId)
    ) {
      sent = shortenedQuoteToken(quote)
      // The sent bubble's chip jumps by its own text, which is the short text after a restart.
      rememberNativeChatQuoteSource(quotedText(sent), source)
      fullQuotes.set(quoteKey(quotedText(sent)), quote)
    }
    result += text.slice(cursor, at) + sent
    cursor = at + token.length
  }
  return result + text.slice(cursor)
}

/** The full quote of a short quote this app sent; other text as it is. */
export function nativeChatFullQuote(text: string): string {
  return fullQuotes.get(quoteKey(text)) ?? text
}
