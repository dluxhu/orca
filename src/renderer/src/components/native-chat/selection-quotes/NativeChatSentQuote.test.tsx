// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const opened = vi.hoisted(() => ({ open: vi.fn(), toast: vi.fn() }))
vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'light' } })
}))
vi.mock('@/components/terminal-pane/links/files/terminal-file-open-routing', () => ({
  openDetectedFilePath: opened.open
}))
vi.mock('sonner', () => ({ toast: opened.toast }))

import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMarkdown } from '../markdown/NativeChatMarkdown'
import { NativeChatMarkdownImageOwnerContext } from '../media/images/native-chat-markdown-image-owner'
import { NativeChatQuoteJumpContext, type NativeChatQuoteJump } from './use-native-chat-quote-jump'
import { formatNativeChatQuote } from './native-chat-quote-selection'
import { rememberNativeChatQuoteSource } from './native-chat-quote-sources'

afterEach(() => {
  cleanup()
  localStorage.clear()
  opened.open.mockReset()
  opened.toast.mockReset()
})

const OWNER = {
  fileLinkContext: { worktreeId: 'w1', worktreePath: '/repo', runtimeEnvironmentId: null },
  runtimeContext: null,
  isVisible: true
}

function sent(content: string, jump: NativeChatQuoteJump = () => true) {
  return render(
    <TooltipProvider delayDuration={0}>
      <NativeChatMarkdownImageOwnerContext.Provider value={OWNER}>
        <NativeChatQuoteJumpContext.Provider value={jump}>
          <NativeChatMarkdown content={content} variant="document" quoteChips />
        </NativeChatQuoteJumpContext.Provider>
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
}

it('shows a sent quote as a button that jumps to its message, with no open or close state', () => {
  rememberNativeChatQuoteSource('quoted\nwords', { messageId: 'reply-1', place: null })
  const jump = vi.fn(() => true)
  sent('> quoted\n> words\n\nmy reply', jump)
  const chip = screen.getByRole('button', { name: 'Quote: quoted words' })
  expect(chip).not.toHaveAttribute('aria-expanded')
  expect(screen.getByText('my reply')).toBeInTheDocument()
  fireEvent.click(chip)
  expect(jump).toHaveBeenCalledWith({ messageId: 'reply-1', place: null }, 'quoted\nwords')
  expect(document.querySelector('blockquote')).toBeNull()
})

// Each quote, as "Add to chat" took it from a reply, and as the user sends it after their own text.
it.each([
  'use <div className="x">hello</div> there',
  'a <br> b',
  'x &amp; y',
  '```ts\nconst a = 1\n```',
  '# a comment\n- removed line',
  '- removed',
  '1. step',
  'v1.2',
  'const x = 1',
  'C++',
  '  indented code\n\n  more'
])('jumps from the sent quote of %j to its message', (quote) => {
  const place = { offset: 2, length: 5, hash: 'h' }
  rememberNativeChatQuoteSource(quote, { messageId: 'reply-2', place })
  const jump = vi.fn(() => true)
  sent(`my words\n\n${formatNativeChatQuote(quote)}reply`, jump)
  fireEvent.click(screen.getByRole('button', { name: /^Quote: / }))
  expect(jump).toHaveBeenCalledWith({ messageId: 'reply-2', place }, quote.trim())
  expect(opened.toast).not.toHaveBeenCalled()
})

it('shows the full quoted text when the chip has keyboard focus', async () => {
  sent('> a long quote\n> on two lines\n\nreply')
  const chip = screen.getByRole('button', { name: 'Quote: a long quote on two lines' })
  await act(async () => {
    chip.focus()
  })
  expect(await screen.findByRole('tooltip')).toHaveTextContent('a long quote on two lines')
})

it('opens the quoted file at its first line and highlights that line', () => {
  sent('> src/a.ts:12-14\n> ```ts\n> const a = 1\n> ```\n\nreply')
  fireEvent.click(screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ }))
  expect(opened.open).toHaveBeenCalledWith(
    '/repo/src/a.ts',
    12,
    1,
    expect.objectContaining({ worktreeId: 'w1', revealLength: Number.MAX_SAFE_INTEGER })
  )
  expect(opened.toast).not.toHaveBeenCalled()
})

it('shows a notice when the quote has no known source', () => {
  sent('> typed by hand\n\nreply')
  fireEvent.click(screen.getByRole('button', { name: 'Quote: typed by hand' }))
  expect(opened.toast).toHaveBeenCalledWith('The source of this quote is not available.')
  expect(opened.open).not.toHaveBeenCalled()
})

it('keeps blockquotes as text where quote chips are off', () => {
  render(<NativeChatMarkdown content="> quoted" variant="document" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(document.querySelector('blockquote')).toHaveTextContent('quoted')
})
