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

const ONE_EMPTY_LINE = 'above\n\n\n> q\n\n\nbelow'

it('shows only the user empty lines next to a quote in the composer', async () => {
  expect(await visibleComposerLines(ONE_EMPTY_LINE)).toEqual(['above', '', CHIP, '', 'below'])
})

it('shows only the user empty lines next to a quote when sent', () => {
  expect(renderedBlocks(ONE_EMPTY_LINE)).toEqual(['above', '', CHIP, '', 'below'])
})

it('shows the line to type in below a quote that Add to chat put at the end', async () => {
  expect(await visibleComposerLines('> q\n\n')).toEqual([CHIP, ''])
  cleanup()
  expect(await visibleComposerLines('> q\n')).toEqual([CHIP, ''])
})

/**
 * Backspace at the start and Delete at the end of each line. A number: the key selects that chip
 * (0 is the first), and the next press deletes it. A string: the text after the key.
 */
const KEY_TABLE: [text: string, backspace: (number | string)[], del: (number | string)[]][] = [
  ['> q\n\n', ['> q\n\n', 0, 0], ['> q\n', '> q\n', '> q\n']],
  [
    'above\n\n> q\n\n',
    ['above\n\n> q\n\n', 'above\n\n> q\n\n', 'above\n\n> q\n\n', 0, 0],
    [0, 0, 'above\n\n> q\n', 'above\n\n> q\n', 'above\n\n> q\n']
  ],
  [
    'above\n\n> q\n\n\nbelow',
    [
      'above\n\n> q\n\n\nbelow',
      'above\n\n> q\n\n\nbelow',
      'above\n\n> q\n\n\nbelow',
      0,
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow'
    ],
    [
      0,
      0,
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\n\nbelow'
    ]
  ],
  [
    'above\n\n\n> q\n\nbelow',
    [
      'above\n\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      0,
      0
    ],
    [
      'above\n\n> q\n\nbelow',
      'above\n\n> q\n\nbelow',
      0,
      'above\n\n\n> q\n\nbelow',
      'above\n\n\n> q\n\nbelow',
      'above\n\n\n> q\n\nbelow'
    ]
  ],
  [
    '> a\n\n\n\n> b\n\n',
    ['> a\n\n\n\n> b\n\n', 0, '> a\n\n\n> b\n\n', '> a\n\n\n> b\n\n', '> a\n\n\n> b\n\n', 1, 1],
    [
      '> a\n\n\n> b\n\n',
      '> a\n\n\n> b\n\n',
      '> a\n\n\n> b\n\n',
      '> a\n\n\n> b\n\n',
      '> a\n\n\n\n> b\n',
      '> a\n\n\n\n> b\n',
      '> a\n\n\n\n> b\n'
    ]
  ],
  [
    'a\n\n\n\nb',
    ['a\n\n\n\nb', 'a\n\n\nb', 'a\n\n\nb', 'a\n\n\nb', 'a\n\n\nb'],
    ['a\n\n\nb', 'a\n\n\nb', 'a\n\n\nb', 'a\n\n\nb', 'a\n\n\n\nb']
  ]
]

const KEY_CASES = KEY_TABLE.flatMap(([text, backspace, del]) => {
  const lines = text.split('\n')
  const start = (line: number) => lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0)
  return [
    ...backspace.map((outcome, line) => ['Backspace', text, line, start(line), outcome] as const),
    ...del.map(
      (outcome, line) => ['Delete', text, line, start(line) + lines[line].length, outcome] as const
    )
  ]
})

it.each(KEY_CASES)('%s on %j line %i', (key, text, _line, caret, outcome) => {
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
  const chipPositions: number[] = []
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'nativeChatQuote') {
      chipPositions.push(position)
    }
  })
  act(() => {
    input.setSelectionRange(caret, caret)
    fireEvent.keyDown(screen.getByRole('textbox'), { key })
  })
  if (typeof outcome === 'string') {
    expect(input.value).toBe(outcome)
    expect(editor.state.selection.toJSON().type).toBe('text')
    return
  }
  expect(input.value).toBe(text)
  expect(editor.state.selection.toJSON()).toEqual({
    type: 'node',
    anchor: chipPositions[outcome]
  })
  act(() => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key })
  })
  expect(input.value.split('> ').length).toBe(text.split('> ').length - 1)
})

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
