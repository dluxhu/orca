// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/components/native-chat/telemetry/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn()
}))
vi.mock('@/lib/syntax-highlighting/oniguruma', async () => ({
  loadOniguruma: (await import('@/lib/syntax-highlighting/oniguruma-test-harness'))
    .loadNodeOniguruma
}))
vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'light' } })
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import { TranslationScopeProvider } from '@/i18n/translation-scope-provider'
import { MessageRow } from '../../messages/rows/NativeChatMessageRow'
import { readNativeChatQuotableSelection } from '../../selection-quotes/native-chat-quote-selection'
import { NativeChatMarkdown } from '../../markdown/NativeChatMarkdown'
import { clearNativeChatComposerDraftsForTests } from '../../drafts/native-chat-draft-reset'
import {
  formatNativeChatQuote,
  quotedText
} from '../../selection-quotes/native-chat-quote-selection'
import {
  nativeChatQuoteSource,
  QUOTE_SOURCE_LIMIT,
  rememberNativeChatQuoteSource
} from '../../selection-quotes/native-chat-quote-sources'
import {
  nativeChatFullQuote,
  shortenSameChatQuotes
} from '../../selection-quotes/native-chat-quote-shortening'
import { NativeChatQuoteJumpContext } from '../../selection-quotes/use-native-chat-quote-jump'
import type { NativeChatStructuredComposerTransport } from './native-chat-structured-composer-transport'
import { useNativeChatStructuredComposerSend } from './use-native-chat-structured-composer-send'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  clearNativeChatComposerDraftsForTests()
})

const IN_CHAT = { messageId: 'reply-1', place: null }
const OTHER_CHAT = { messageId: 'other-chat-reply', place: null }

let clock = 0
const message = (fields: Partial<NativeChatMessage>): NativeChatMessage => ({
  id: `m-${++clock}`,
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Another reply.' }],
  timestamp: clock,
  source: 'transcript',
  ...fields
})
/** The quoted reply, as Markdown: marks and line breaks that the rendered quote has not. */
const reply = (quote: string, fields: Partial<NativeChatMessage> = {}) =>
  message({
    id: IN_CHAT.messageId,
    blocks: [{ type: 'text', text: `Intro **text**.\n\n${quote.replace(/ /g, '\n')}\n\n- end` }],
    ...fields
  })
const replies = (count: number) => Array.from({ length: count }, () => message({}))
const user = (fields: Partial<NativeChatMessage> = {}) =>
  message({ role: 'user', blocks: [{ type: 'text', text: '/x' }], ...fields })
const system = (presentation: string) =>
  message({ role: 'system', blocks: [{ type: 'text', text: 'Context', presentation }] })

const words = (count: number) => Array.from({ length: count }, () => 'alpha').join(' ')
const LONG = [
  'The parser reads quoted lines as one chip.',
  `${words(70)}.`,
  'The agent gets the same text shape.'
].join('\n')
const LONG_SHORT = [
  '> The parser reads quoted lines as one chip. …',
  '> (70 quoted words left out; the full text is in your earlier reply)',
  '> … The agent gets the same text shape.'
].join('\n')
// One sentence over the threshold: each end is cut to 80 characters at a space.
const ONE_SENTENCE = words(100)
const ONE_SENTENCE_SHORT = [
  `> ${words(13)} …`,
  '> (74 quoted words left out; the full text is in your earlier reply)',
  `> … ${words(13)}`
].join('\n')
// A first sentence too short to say anything: the first 80 characters, cut at a space.
const SHORT_FIRST = `E.g. ${words(80)}. The last sentence is here now.`
const SHORT_FIRST_SHORT = [
  `> E.g. ${words(12)} …`,
  '> (68 quoted words left out; the full text is in your earlier reply)',
  '> … The last sentence is here now.'
].join('\n')
const CHARS_400 = `${words(66)}. abc`
const CHARS_401 = `${words(66)}. abcd`
const FILE_QUOTE = `src/app.ts:1-40\n\`\`\`ts\n${words(80)}\n\`\`\``
const TERMINAL_QUOTE = `zsh\n\`\`\`\n${words(80)}\n\`\`\``

/** Sends `> quote`, a blank line and a comment through the structured composer send. */
async function send(
  quote: string,
  source: typeof IN_CHAT | null,
  chatMessages: NativeChatMessage[] = [reply(quote)]
): Promise<string> {
  if (source) {
    rememberNativeChatQuoteSource(quote, source)
  }
  const transport = {
    capturePresentation: () => () => true,
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => ({ handled: false, accepted: false, error: null })),
    optionsSurface: {
      getSnapshot: () => [],
      setOption: vi.fn(),
      invokeAction: vi.fn(),
      subscribe: () => () => {}
    },
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'local',
    sessionId: 'quote-short',
    runtimeEnvironmentId: null
  } as unknown as NativeChatStructuredComposerTransport
  const { result } = renderHook(() =>
    useNativeChatStructuredComposerSend({
      agent: 'claude',
      draftScopeKey: 'agent-session:quote-short',
      imageAttachments: [],
      structuredTransport: transport,
      isComposing: () => false,
      clearSkillOrigin: vi.fn(),
      setDraft: vi.fn(),
      setCaret: vi.fn(),
      chatMessages
    })
  )
  await act(async () => {
    await result.current(`${formatNativeChatQuote(quote)}my comment`, [])
  })
  return String(vi.mocked(transport.send).mock.calls[0]?.[0])
}

const SHORTENED: [string, string, string][] = [
  ['a long quote of a reply in this chat', LONG, LONG_SHORT],
  ['a long one-sentence quote', ONE_SENTENCE, ONE_SENTENCE_SHORT],
  ['a long quote with a short first sentence', SHORT_FIRST, SHORT_FIRST_SHORT]
]

it.each(SHORTENED)('sends %s shortened', async (_name, quote, short) => {
  expect(await send(quote, IN_CHAT)).toBe(`${short}\n\nmy comment`)
})

it('sends a quote of 401 characters shortened, and one of 400 in full', async () => {
  expect(CHARS_400).toHaveLength(400)
  expect(CHARS_401).toHaveLength(401)
  expect(await send(CHARS_401, IN_CHAT)).toMatch(/^> .* …\n> \(\d+ quoted words left out; /)
  cleanup()
  expect(await send(CHARS_400, IN_CHAT)).toBe(`${formatNativeChatQuote(CHARS_400)}my comment`)
})

// The agent has the reply only when it is in its context, and the reply holds the quote.
const IN_FULL: [string, string, typeof IN_CHAT | null, NativeChatMessage[] | undefined][] = [
  ['a file quote', FILE_QUOTE, null, undefined],
  ['a terminal quote', TERMINAL_QUOTE, null, undefined],
  ['a quote of a reply in another chat', LONG, OTHER_CHAT, undefined],
  [
    'a quote from before /clear',
    LONG,
    IN_CHAT,
    [reply(LONG), user({ command: { name: 'clear' } })]
  ],
  [
    'a quote from before /compact',
    LONG,
    IN_CHAT,
    [reply(LONG), user({ command: { name: 'compact' } })]
  ],
  ['a quote from before a compaction', LONG, IN_CHAT, [reply(LONG), system('compaction')]],
  [
    'a quote from before a cleared context',
    LONG,
    IN_CHAT,
    [reply(LONG), system('context-cleared')]
  ],
  [
    // Literal counts: a test that reads the constant moves with a changed constant.
    'a quote of the reply 6 back, older than the last 5 replies (an automatic compaction leaves no row)',
    LONG,
    IN_CHAT,
    [reply(LONG), ...replies(5)]
  ],
  [
    'a quote whose reply id names a reply without the quote',
    LONG,
    IN_CHAT,
    [reply('Other words entirely.')]
  ],
  ['a quote of a screen-scraped reply', LONG, IN_CHAT, [reply(LONG, { source: 'scrape' })]],
  ['a quote of a hook copy of a reply', LONG, IN_CHAT, [reply(LONG, { source: 'hook' })]]
]

it.each(IN_FULL)('sends %s in full', async (_name, quote, source, chat) => {
  expect(await send(quote, source, chat)).toBe(`${formatNativeChatQuote(quote)}my comment`)
})

it('sends a quote of the reply 5 back shortened', async () => {
  expect(await send(LONG, IN_CHAT, [reply(LONG), ...replies(4)])).toBe(
    `${LONG_SHORT}\n\nmy comment`
  )
})

it(`keeps the full text of the last ${QUOTE_SOURCE_LIMIT} shortened quotes only`, () => {
  const quote = (index: number) => `Quote ${index}. ${LONG}`
  const shortText = (index: number) => {
    rememberNativeChatQuoteSource(quote(index), IN_CHAT)
    return quotedText(
      shortenSameChatQuotes(formatNativeChatQuote(quote(index)), [reply(quote(index))])
    )
  }
  const first = shortText(0)
  for (let index = 1; index <= QUOTE_SOURCE_LIMIT; index++) {
    shortText(index)
  }
  const last = shortText(QUOTE_SOURCE_LIMIT + 1)
  expect(nativeChatFullQuote(last)).toBe(quote(QUOTE_SOURCE_LIMIT + 1))
  expect(nativeChatFullQuote(first)).toBe(first)
})

const FILLER = `${words(70)}.`

/** The quote "Add to chat" takes when the whole drawn reply is selected. */
function drawnQuote(markdown: string): string {
  const view = render(
    <TooltipProvider>
      <MessageRow
        message={message({ id: IN_CHAT.messageId, blocks: [{ type: 'text', text: markdown }] })}
        expandSignal={false}
        onScrollMessageToTop={vi.fn()}
      />
    </TooltipProvider>,
    { wrapper: TranslationScopeProvider }
  )
  const source = view.container.querySelector('[data-native-chat-quote-source]')!
  const range = document.createRange()
  range.selectNodeContents(source)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  const quote = readNativeChatQuotableSelection(view.container)!.text
  cleanup()
  return quote
}

it.each([
  ['a code block', `Run this:\n\n\`\`\`ts\nconst answer = 42\n\`\`\`\n\n${FILLER}`, 'TypeScript'],
  ['a numbered list', `Steps:\n\n1. Open the file.\n2. Save it.\n\n${FILLER}`, 'Save it.'],
  ['a link', `Read [the guide](https://example.com/guide) first.\n\n${FILLER}`, 'the guide']
])('sends a drawn quote of a recent reply with %s shortened', async (_name, markdown, part) => {
  const quote = drawnQuote(markdown)
  expect(quote).toContain(part)
  expect(quote.length).toBeGreaterThan(400)
  const sent = await send(quote, IN_CHAT, [
    message({ id: IN_CHAT.messageId, blocks: [{ type: 'text', text: markdown }] })
  ])
  expect(sent).toMatch(/\(\d+ quoted words left out; the full text is in your earlier reply\)/)
})

it('shows the full quote in the sent chip and jumps to its reply', async () => {
  await send(LONG, IN_CHAT)
  const jump = vi.fn(() => true)
  // The transcript holds the text the agent got.
  const sentText = `${LONG_SHORT}\n\nmy comment`
  render(
    <TooltipProvider delayDuration={0}>
      <NativeChatQuoteJumpContext.Provider value={jump}>
        <NativeChatMarkdown content={sentText} variant="document" quoteChips />
      </NativeChatQuoteJumpContext.Provider>
    </TooltipProvider>
  )
  const chip = screen.getByRole('button', { name: `Quote: ${LONG.replace(/\s+/g, ' ')}` })
  fireEvent.click(chip)
  expect(jump).toHaveBeenCalledWith(IN_CHAT, LONG)
})

it('keeps the jump of a short quote after the full text is gone from memory', async () => {
  await send(LONG, IN_CHAT)
  expect(nativeChatQuoteSource(quotedText(`${LONG_SHORT}\n\n`))).toEqual(IN_CHAT)
})
