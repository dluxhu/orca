// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatPaneHeader } from '../../pane/actions/NativeChatPaneHeader'
import { routeNativeChatRootKeyToInput } from '../../composer/focus/native-chat-root-key-routing'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../../../../shared/agent-session/journal/agent-session-journal-types'
import { NativeChatRawFrame, NativeChatRawPanel } from './NativeChatRawPanel'

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

function sentEntry(blocks: Extract<AgentJournalItemBody, { kind: 'message' }>['blocks']) {
  render(
    <NativeChatRawPanel items={[item('sent', 1, { kind: 'message', role: 'user', blocks })]} />
  )
  const entry = screen.getAllByRole('listitem')[0]
  return {
    text: entry.querySelector('pre')?.textContent,
    images: within(entry)
      .queryAllByRole('listitem')
      .map((image) => image.textContent)
  }
}

describe('a sent message with images', () => {
  it('lists each image before the text and keeps it out of the sent text', () => {
    expect(
      sentEntry([
        { type: 'text', text: 'look' },
        { type: 'image-ref', path: '/shots/a.png' }
      ])
    ).toEqual({ text: 'look', images: ['Image: /shots/a.png'] })
  })

  it('joins the text around an image as Claude does', () => {
    expect(
      sentEntry([
        { type: 'text', text: 'first' },
        { type: 'image-ref', url: 'https://example.invalid/x.png' },
        { type: 'text', text: 'second' }
      ])
    ).toEqual({ text: 'first\nsecond', images: ['Image: https://example.invalid/x.png'] })
  })
})

describe('the fold boundary', () => {
  const folds = (text: string): boolean => {
    render(
      <NativeChatRawPanel
        items={[item('x', 1, { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] })]}
      />
    )
    const more = screen.queryByRole('button', { name: 'Show more' }) !== null
    cleanup()
    return more
  }
  const lines = (count: number): string =>
    Array.from({ length: count }, (_, index) => `l${index}`).join('\n')

  it('folds past 16 lines or 1600 characters', () => {
    expect({
      lines16: folds(lines(16)),
      lines17: folds(lines(17)),
      chars1600: folds('a'.repeat(1600)),
      chars1601: folds('a'.repeat(1601))
    }).toEqual({ lines16: false, lines17: true, chars1600: false, chars1601: true })
  })
})

describe('an entry update', () => {
  it('formats a row again only when its revision changes', () => {
    const reply = (text: string, revision: number): AgentJournalRenderItem => ({
      ...item('reply', 1, { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }),
      revision
    })
    const view = render(<NativeChatRawPanel items={[reply('one', 1)]} />)
    view.rerender(<NativeChatRawPanel items={[reply('same revision', 1)]} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('one')
    view.rerender(<NativeChatRawPanel items={[reply('two', 2)]} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('two')
  })
})

function Chat({ tabId }: { tabId: string }): React.JSX.Element {
  return (
    <TooltipProvider>
      <NativeChatPaneHeader
        tabId={tabId}
        worktreeId="workspace"
        groupId="group"
        nativeChat={{ sessionId: 'session', agent: undefined }}
        focused
        colorScheme={undefined}
      />
      <NativeChatRawFrame tabId={tabId} items={[]} panel={null}>
        transcript
      </NativeChatRawFrame>
    </TooltipProvider>
  )
}

describe('the Show raw toggle', () => {
  it('opens the panel only for its own chat tab and keeps it open after a remount', () => {
    const view = render(<Chat tabId="tab-a" />)
    const toggle = () => screen.getByRole('button', { name: 'Show raw' })
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Raw messages' })).toBeNull()
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Raw messages' })).toBeInTheDocument()
    view.rerender(<Chat key="tab-b" tabId="tab-b" />)
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Raw messages' })).toBeNull()
    view.rerender(<Chat key="tab-a" tabId="tab-a" />)
    expect(screen.getByRole('region', { name: 'Raw messages' })).toBeInTheDocument()
  })
})

describe('Space in the panel', () => {
  it('stays with the focused panel and does not reach the composer', () => {
    render(<NativeChatRawPanel items={[]} />)
    const panel = screen.getByRole('region', { name: 'Raw messages' })
    expect(panel).toHaveAttribute('tabindex', '0')
    panel.focus()
    const insertTypedText = vi.fn(() => true)
    routeNativeChatRootKeyToInput(
      {
        key: ' ',
        ctrlKey: false,
        metaKey: false,
        defaultPrevented: false,
        target: panel,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      },
      { insertTypedText, focus: vi.fn() } as never,
      null
    )
    expect(document.activeElement).toBe(panel)
    expect(insertTypedText).not.toHaveBeenCalled()
  })
})

describe('the panel scroll', () => {
  // happy-dom lays nothing out, so each element gets a fixed viewport and a settable content height.
  const viewport = { clientHeight: 200, scrollHeight: 1000 }
  const tops = new WeakMap<Element, number>()
  const restore: (() => void)[] = []
  function fakeGeometry(): void {
    const define = (name: string, descriptor: PropertyDescriptor): void => {
      const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor })
      restore.push(() =>
        before
          ? Object.defineProperty(HTMLElement.prototype, name, before)
          : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
      )
    }
    define('clientHeight', { get: () => viewport.clientHeight })
    define('scrollHeight', { get: () => viewport.scrollHeight })
    define('scrollTop', {
      get(this: Element) {
        return tops.get(this) ?? 0
      },
      set(this: Element, value: number) {
        tops.set(this, value)
      }
    })
  }
  afterEach(() => {
    for (const undo of restore.splice(0)) {
      undo()
    }
    viewport.scrollHeight = 1000
  })
  const rows = (count: number): AgentJournalRenderItem[] =>
    Array.from({ length: count }, (_, index) =>
      item(`row-${index}`, index, { kind: 'status', text: `row ${index}` })
    )
  const panel = () => screen.getByRole('region', { name: 'Raw messages' })
  const atEnd = () => panel().scrollTop >= viewport.scrollHeight - viewport.clientHeight

  it('opens at the newest entry', () => {
    fakeGeometry()
    render(<NativeChatRawPanel items={rows(3)} />)
    expect(atEnd()).toBe(true)
  })

  it('follows new entries while it is at the end', () => {
    fakeGeometry()
    const view = render(<NativeChatRawPanel items={rows(3)} />)
    viewport.scrollHeight = 1500
    view.rerender(<NativeChatRawPanel items={rows(4)} />)
    expect(atEnd()).toBe(true)
  })

  it('stays where the reader scrolled up to', () => {
    fakeGeometry()
    const view = render(<NativeChatRawPanel items={rows(3)} />)
    panel().scrollTop = 100
    fireEvent.scroll(panel())
    viewport.scrollHeight = 1500
    view.rerender(<NativeChatRawPanel items={rows(4)} />)
    expect(panel().scrollTop).toBe(100)
  })
})
