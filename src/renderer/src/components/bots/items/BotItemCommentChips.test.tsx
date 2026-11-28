// @vitest-environment happy-dom

import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeTestBotItem } from '../../../../../shared/bots/bot-item.test-fixture'
import type { BotItemEvent } from '../../../../../shared/bots/bot-items'
import { agentReferenceNote } from '../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { fixtureCos } from '../../../component-fixtures/fixture-bot-panel'
import { NativeChatSelectionQuote } from '../../native-chat/selection-quotes/NativeChatSelectionQuote'
import { BotItemActivityList } from './BotItemActivityList'

const opened = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/agent-session/open/open-agent-message-sender', () => ({
  openOrchestrationDispatch: opened
}))

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  window.localStorage.clear()
  opened.mockClear()
  cleanup()
})

const item = makeTestBotItem(1)
const comment = (id: string, text: string, owner = true): BotItemEvent => ({
  id,
  kind: 'commented',
  actor: owner ? { kind: 'owner' } : { kind: 'bot', botId: fixtureCos.id, chatId: 'chat-home' },
  data: { text },
  at: 0
})

const NONE_ADDED: string[] = []

function ItemPage({
  events,
  added = NONE_ADDED
}: {
  events: BotItemEvent[]
  added?: string[]
}): React.JSX.Element {
  const root = useRef<HTMLDivElement | null>(null)
  const box = useRef({ acceptsText: () => true, appendText: (text: string) => added.push(text) })
  return (
    <TooltipProvider>
      <div ref={root}>
        <BotItemActivityList bot={fixtureCos} item={item} events={events} />
        <NativeChatSelectionQuote rootRef={root} composerRef={box} enabled />
      </div>
    </TooltipProvider>
  )
}

function selectText(text: string): void {
  const range = document.createRange()
  range.selectNodeContents(screen.getByText(text))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
    fireEvent.mouseUp(window, { button: 0, detail: 1, clientX: 10, clientY: 10 })
  })
}

it("draws the owner's quotes and chat mentions as chat's chips, without the routing notes", () => {
  const note = agentReferenceNote('Review chat', 'orca_session_id:abc', 'chat')
  render(
    <ItemPage
      events={[
        comment('e1', `> Approve the first two\n\nAsk @Review chat about it\n\n${note}`),
        comment('e2', '> A quote the bot wrote', false)
      ]}
    />
  )
  expect(screen.getByRole('button', { name: 'Quote: Approve the first two' })).not.toBeNull()
  expect(screen.queryByText(/orca orchestration send/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open Review chat' }))
  expect(opened).toHaveBeenCalledWith(
    'orca_session_id:abc',
    'Review chat',
    { kind: 'local' },
    expect.anything()
  )
  // An agent's own Markdown quote stays a quote.
  expect(screen.queryByRole('button', { name: 'Quote: A quote the bot wrote' })).toBeNull()
  expect(screen.getByText('A quote the bot wrote').closest('blockquote')).not.toBeNull()
})

it('a quote chip jumps back to the quoted words in the Activity', async () => {
  const added: string[] = []
  const quoted = comment('e1', 'Approve the first two; hold the rest.', false)
  const { rerender } = render(<ItemPage events={[quoted]} added={added} />)
  selectText('Approve the first two; hold the rest.')
  fireEvent.click(await screen.findByRole('button', { name: 'Add to chat' }))
  expect(added).toEqual(['> Approve the first two; hold the rest.\n\n'])
  window.getSelection()?.removeAllRanges()
  rerender(<ItemPage events={[quoted, comment('e2', `${added[0]}Agreed.`)]} added={added} />)
  const list = document.querySelector('[data-native-chat-quote-source]')
  expect(document.activeElement).not.toBe(list)
  fireEvent.click(
    screen.getByRole('button', { name: 'Quote: Approve the first two; hold the rest.' })
  )
  expect(document.activeElement).toBe(list)
})
