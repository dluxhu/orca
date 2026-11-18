// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/store/index', async (importOriginal) => importOriginal())

import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import { promptEditor } from './native-chat-prompt-editor.test-support'
import { NativeChatMarkdown } from '../../markdown/NativeChatMarkdown'
import { TooltipProvider } from '@/components/ui/tooltip'
import { updateNativeChatComposerDraft } from '../../drafts/native-chat-composer-draft-store'
import { clearNativeChatComposerDraftsForTests } from '../../drafts/native-chat-draft-reset'

afterEach(() => {
  cleanup()
  clearNativeChatComposerDraftsForTests()
})

const CHIP = 'CHIP'

/** The composer lines a reader sees: separator lines are hidden. */
async function visibleComposerLines(text: string, scopeKey?: string): Promise<string[]> {
  const inputRef = createRef<NativeChatComposerInput>()
  const view = render(
    <NativeChatPromptEditor
      scopeKey={scopeKey}
      inputRef={inputRef}
      initialValue={text}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  await waitFor(() => expect(view.container.textContent).toContain('Quote: '))
  // The text the agent gets keeps every line.
  expect(inputRef.current!.value).toBe(text)
  return [...view.container.querySelectorAll('.ProseMirror > p')]
    .filter((line) => !line.hasAttribute('data-quote-separator'))
    .map((line) => (line.textContent?.startsWith('Quote: ') ? CHIP : (line.textContent ?? '')))
}

/** The sent message, as blocks: a quote, a paragraph's text, or '' for a visible empty line. */
function renderedBlocks(text: string): string[] {
  const view = render(
    <TooltipProvider>
      <NativeChatMarkdown content={text} variant="document" quoteChips />
    </TooltipProvider>
  )
  const root = view.container.querySelector('.native-chat-markdown')!
  return [...root.children].map((block) =>
    block.matches('[data-native-chat-sent-quote]')
      ? CHIP
      : block.tagName === 'P' &&
          block.children.length === 1 &&
          block.firstElementChild?.tagName === 'BR'
        ? ''
        : (block.textContent ?? '')
  )
}

const TABLE: [string, string, string[]][] = [
  ['no user empty line', 'above\n\n> q\n\nbelow', ['above', CHIP, 'below']],
  ['one user empty line', 'above\n\n\n> q\n\n\nbelow', ['above', '', CHIP, '', 'below']],
  [
    'two user empty lines',
    'above\n\n\n\n> q\n\n\n\nbelow',
    ['above', '', '', CHIP, '', '', 'below']
  ]
]

it.each(TABLE)(
  'shows only the user empty lines next to a quote in the composer (%s)',
  async (_name, text, lines) => {
    expect(await visibleComposerLines(text)).toEqual(lines)
  }
)

it.each(TABLE)(
  'shows only the user empty lines next to a quote when sent (%s)',
  (_name, text, lines) => {
    expect(renderedBlocks(text)).toEqual(lines)
  }
)

it('shows the line to type in below a quote that Add to chat put at the end', async () => {
  expect(await visibleComposerLines('> q\n\n')).toEqual([CHIP, ''])
  cleanup()
  expect(await visibleComposerLines('> q\n')).toEqual([CHIP, ''])
})

it.each([
  [
    'Backspace',
    'at the start of the line below a chip',
    'above\n\n> q\n\nbelow',
    12,
    10,
    'above\n\n\n\nbelow'
  ],
  ['Backspace', 'on the line Add to chat leaves below a chip', '> q\n\n', 5, 1, '\n\n'],
  [
    'Delete',
    'at the end of the line above a chip',
    'above\n\n> q\n\nbelow',
    5,
    10,
    'above\n\n\n\nbelow'
  ]
])(
  'selects the chip on %s %s, and deletes it on the next press',
  (key, _where, text, caret, anchor, after) => {
    const inputRef = createRef<NativeChatComposerInput>()
    render(
      <NativeChatPromptEditor
        inputRef={inputRef}
        initialValue={text}
        disabled={false}
        placeholder="Message"
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    const input = inputRef.current!
    const editor = promptEditor(screen.getByRole('textbox'))
    act(() => {
      input.setSelectionRange(caret, caret)
      fireEvent.keyDown(screen.getByRole('textbox'), { key })
    })
    expect(input.value).toBe(text)
    expect(editor.state.selection.toJSON()).toEqual({ type: 'node', anchor })
    act(() => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key })
    })
    expect(input.value).toBe(after)
  }
)

it('keeps the user empty lines of a draft when it loads again', async () => {
  const text = 'above\n\n\n> q\n\n\n\nbelow'
  updateNativeChatComposerDraft('blank-lines', { text }, 'immediate')
  expect(await visibleComposerLines(text, 'blank-lines')).toEqual([
    'above',
    '',
    CHIP,
    '',
    '',
    'below'
  ])
})

it('shows the separator line while the caret is on it', async () => {
  const inputRef = createRef<NativeChatComposerInput>()
  const view = render(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={'above\n\n> q\n\nbelow'}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  await waitFor(() => expect(view.container.textContent).toContain('Quote: '))
  const separators = () => view.container.querySelectorAll('[data-quote-separator]').length
  expect(separators()).toBe(2)
  act(() => inputRef.current!.setSelectionRange(6, 6))
  expect(separators()).toBe(1)
})
