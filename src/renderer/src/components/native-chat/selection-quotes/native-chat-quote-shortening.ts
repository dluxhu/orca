import { promptTextContent, QUOTE_NODE } from '../composer/editor/native-chat-prompt-document-text'
import { quotedText } from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import {
  nativeChatQuoteSource,
  QUOTE_SOURCE_LIMIT,
  quoteKey,
  rememberNativeChatQuoteSource
} from './native-chat-quote-sources'
import { isNativeChatContextClear } from '../../../../../shared/agent-session/conversation-context/agent-session-context-clear'
import { orderNativeChatDisplayMessages } from '../../../../../shared/native-chat/transcript/messages/native-chat-message-order'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { getCodeFenceLanguageLabel } from '../markdown/code/code-fence-language-label'

/** A quote of an earlier message goes to the agent shortened only when it is longer than this. */
export const QUOTE_SHORTEN_THRESHOLD = 400
const EDGE = 80
// A first or last sentence shorter than this ("E.g.") says too little: the edge is cut instead.
const SHORT_SENTENCE = 20
// Claude's automatic compaction leaves no row in the chat: only this many last replies count.
export const RECENT_REPLIES = 5

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

/** Who wrote the quoted message: the agent (a reply) or the user. */
type QuoteAuthor = 'reply' | 'user'

/** The quote token in the short shape: the first sentence, how much is left out, the last one. */
export function shortenedQuoteToken(quote: string, author: QuoteAuthor = 'reply'): string {
  const flat = quote.replace(/\s+/g, ' ').trim()
  const sentences = flat.split(/(?<=[.!?])\s+/)
  const first = head(sentences[0].length < SHORT_SENTENCE ? flat : sentences[0])
  const lastSentence = sentences.at(-1)!
  const last = tail(lastSentence.length < SHORT_SENTENCE ? flat : lastSentence)
  const omitted = words(flat.slice(first.length, flat.length - last.length))
  return [
    `> ${first} …`,
    `> (${omitted} quoted words left out; the full text is in ${author === 'reply' ? 'your earlier reply' : 'my earlier message'})`,
    `> … ${last}`
  ]
    .join('\n')
    .concat('\n\n')
}

const isContextBoundary = (message: NativeChatMessage): boolean =>
  isNativeChatContextClear(message) ||
  message.command?.name === 'clear' ||
  message.command?.name === 'compact' ||
  message.blocks.some(
    (block) =>
      block.type === 'text' &&
      (block.presentation === 'compaction' || block.presentation === 'context-cleared')
  )

type MarkdownNode = {
  type: string
  value?: string
  lang?: string | null
  children?: MarkdownNode[]
}

const markdown = unified().use(remarkParse).use(remarkGfm)

/**
 * The text of a reply as the chat draws it, which is the text a quote of it has: no Markdown
 * marks, list numbers or link targets, and each code block after its language label.
 */
function drawnText(node: MarkdownNode): string {
  if (node.type === 'code') {
    return `${node.lang ? getCodeFenceLanguageLabel(node.lang) : ''}${node.value ?? ''}`
  }
  return node.value ?? (node.children ?? []).map(drawnText).join('')
}

// A selection has line breaks between blocks that the drawn text has not.
const bare = (text: string): string => text.replace(/\s/g, '')

/**
 * Who wrote the message `messageId` with the quote in it, while the agent still has it; null
 * otherwise. The message is a reply or a user message of this transcript (not a screen scrape or a
 * hook copy), after the last clear or compaction, with fewer than `RECENT_REPLIES` replies after
 * it, and its text holds the quote.
 */
function quoteAuthorInContext(
  quote: string,
  messageId: string,
  chatMessages: readonly NativeChatMessage[]
): QuoteAuthor | null {
  const ordered = orderNativeChatDisplayMessages(chatMessages)
  let replies = 0
  for (let index = ordered.length - 1; index >= 0 && replies < RECENT_REPLIES; index--) {
    const message = ordered[index]
    if (isContextBoundary(message)) {
      return null
    }
    if (
      (message.role !== 'assistant' && message.role !== 'user') ||
      message.source !== 'transcript'
    ) {
      continue
    }
    if (message.id === messageId) {
      const text = message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
      const holdsQuote = bare(drawnText(markdown.parse(text) as MarkdownNode)).includes(bare(quote))
      return holdsQuote ? (message.role === 'assistant' ? 'reply' : 'user') : null
    }
    if (message.role === 'assistant') {
      replies++
    }
  }
  return null
}

/** Keeps the newest `QUOTE_SOURCE_LIMIT` full quotes. */
function rememberFullQuote(short: string, quote: string): void {
  const key = quoteKey(short)
  fullQuotes.delete(key)
  fullQuotes.set(key, quote)
  if (fullQuotes.size > QUOTE_SOURCE_LIMIT) {
    fullQuotes.delete(fullQuotes.keys().next().value!)
  }
}

/**
 * The text for the agent: each long quote of a reply or a user message that the agent still has is
 * in the short shape. The quote's recorded source names the message.
 */
export function shortenSameChatQuotes(
  text: string,
  chatMessages: readonly NativeChatMessage[]
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
    const author =
      quote.length > QUOTE_SHORTEN_THRESHOLD && source
        ? quoteAuthorInContext(quote, source.messageId, chatMessages)
        : null
    if (source && author) {
      sent = shortenedQuoteToken(quote, author)
      // The sent bubble's chip jumps by its own text, which is the short text after a restart.
      rememberNativeChatQuoteSource(quotedText(sent), source)
      rememberFullQuote(quotedText(sent), quote)
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
