// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/components/native-chat/telemetry/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn()
}))
vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'light' } })
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMarkdown } from '../../markdown/NativeChatMarkdown'
import { clearNativeChatComposerDraftsForTests } from '../../drafts/native-chat-draft-reset'
import {
  formatNativeChatQuote,
  quotedText
} from '../../selection-quotes/native-chat-quote-selection'
import {
  nativeChatQuoteSource,
  rememberNativeChatQuoteSource
} from '../../selection-quotes/native-chat-quote-sources'
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
const REPLY: NativeChatMessage = {
  id: 'reply-1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'An earlier reply.' }],
  timestamp: null,
  source: 'transcript'
}
const OTHER_CHAT = { messageId: 'other-chat-reply', place: null }

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
const SHORT = `${words(66)}.`
const FILE_QUOTE = `src/app.ts:1-40\n\`\`\`ts\n${words(80)}\n\`\`\``
const TERMINAL_QUOTE = `zsh\n\`\`\`\n${words(80)}\n\`\`\``

/** Sends `> quote`, a blank line and a comment through the structured composer send. */
async function send(quote: string, source: typeof IN_CHAT | null): Promise<string> {
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
      chatMessages: [REPLY]
    })
  )
  await act(async () => {
    await result.current(`${formatNativeChatQuote(quote)}my comment`, [])
  })
  return String(vi.mocked(transport.send).mock.calls[0]?.[0])
}

it.each([
  ['a long quote of a reply in this chat', LONG, IN_CHAT, `${LONG_SHORT}\n\nmy comment`],
  [
    'a long one-sentence quote of a reply in this chat',
    ONE_SENTENCE,
    IN_CHAT,
    `${ONE_SENTENCE_SHORT}\n\nmy comment`
  ],
  ['a quote of 400 characters or less', SHORT, IN_CHAT, null],
  ['a file quote', FILE_QUOTE, null, null],
  ['a terminal quote', TERMINAL_QUOTE, null, null],
  ['a quote of a reply in another chat', LONG, OTHER_CHAT, null]
])('sends %s as the agent needs it', async (_name, quote, source, shortened) => {
  expect(SHORT.length).toBeLessThanOrEqual(400)
  expect(await send(quote, source)).toBe(shortened ?? `${formatNativeChatQuote(quote)}my comment`)
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
