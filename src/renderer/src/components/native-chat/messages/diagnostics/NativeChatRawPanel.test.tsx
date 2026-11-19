// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../../../../shared/agent-session/journal/agent-session-journal-types'
import { NativeChatRawFrame, NativeChatRawPanel, useNativeChatRawPanel } from './NativeChatRawPanel'

afterEach(cleanup)

function item(
  itemId: string,
  sequence: number,
  body: AgentJournalItemBody
): AgentJournalRenderItem {
  return { itemId, revision: 1, sequence, observedAt: 0, body }
}

const QUOTED = '> the quoted line\n\nmy answer'

describe('the raw panel', () => {
  it('lists entries by sequence, the sent text exactly, and the reply as its record', () => {
    render(
      <NativeChatRawPanel
        items={[
          item('reply', 2, {
            kind: 'message',
            role: 'assistant',
            blocks: [{ type: 'text', text: 'ok' }]
          }),
          item('sent', 1, {
            kind: 'message',
            role: 'user',
            blocks: [
              { type: 'text', text: QUOTED },
              { type: 'text', text: '' },
              { type: 'text', text: 'second block' }
            ]
          })
        ]}
      />
    )
    const region = screen.getByRole('region', { name: 'Raw messages' })
    expect(region).not.toHaveAttribute('aria-live')
    const entries = within(region).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Sent to agent')
    // Claude skips empty text blocks and joins the rest with one newline.
    expect(entries[0].querySelector('pre')?.textContent).toBe(
      '> the quoted line\n\nmy answer\nsecond block'
    )
    expect(entries[1].querySelector('pre')?.textContent).toBe(
      '{\n  "kind": "message",\n  "role": "assistant",\n  "blocks": [\n    {\n      "type": "text",\n      "text": "ok"\n    }\n  ]\n}'
    )
  })

  it('folds a long entry until Show more', () => {
    const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')
    render(
      <NativeChatRawPanel
        items={[
          item('long', 1, { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] })
        ]}
      />
    )
    const more = screen.getByRole('button', { name: 'Show more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('listitem').querySelector('pre')?.textContent).not.toContain('line 29')
    fireEvent.click(more)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('listitem').querySelector('pre')?.textContent).toBe(text)
  })
})

function Chat({ tabId }: { tabId: string }): React.JSX.Element {
  const raw = useNativeChatRawPanel(tabId)
  return (
    <>
      <button type="button" aria-pressed={raw.open} onClick={raw.toggle}>
        Show raw
      </button>
      <NativeChatRawFrame tabId={tabId} items={[]} panel={null}>
        transcript
      </NativeChatRawFrame>
    </>
  )
}

describe('the raw panel toggle', () => {
  it('opens the panel only for its own chat tab and keeps it open after a remount', () => {
    const view = render(<Chat tabId="tab-a" />)
    expect(screen.queryByRole('region', { name: 'Raw messages' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show raw' }))
    expect(screen.getByRole('button', { name: 'Show raw' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Raw messages' })).toBeInTheDocument()
    view.rerender(<Chat key="tab-b" tabId="tab-b" />)
    expect(screen.queryByRole('region', { name: 'Raw messages' })).toBeNull()
    view.rerender(<Chat key="tab-a" tabId="tab-a" />)
    expect(screen.getByRole('region', { name: 'Raw messages' })).toBeInTheDocument()
  })
})
