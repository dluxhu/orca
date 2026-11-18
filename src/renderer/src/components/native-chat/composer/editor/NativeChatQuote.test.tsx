// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import {
  writeNativeChatComposerText,
  type NativeChatComposerInput
} from './native-chat-composer-input'
import { promptEditor } from './native-chat-prompt-editor.test-support'
import { promptTextContent } from './native-chat-prompt-document-text'
import { formatNativeChatQuote } from '../../selection-quotes/native-chat-quote-selection'

afterEach(cleanup)

function setup(value = '') {
  const inputRef = createRef<NativeChatComposerInput>()
  const view = render(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={value}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  const input = inputRef.current!
  return { ...view, input, editor: promptEditor(screen.getByRole('textbox')) }
}

const chips = (editor: ReturnType<typeof promptEditor>) => {
  let count = 0
  editor.state.doc.descendants((node) => {
    count += node.type.name === 'nativeChatQuote' ? 1 : 0
  })
  return count
}

describe('quote chips in the composer', () => {
  it('reads quoted lines, a blank line and the next line as one chip line', () => {
    const doc = promptTextContent('above\n> one\n>\n> two\n\nbelow')
    expect(doc.content?.map((block) => block.content?.map((node) => node.type))).toEqual([
      ['text'],
      ['nativeChatQuote', 'text']
    ])
    expect(doc.content?.[1]?.content?.[0]?.attrs?.token).toBe('> one\n>\n> two\n\n')
    // Quoted lines with text directly below are a lazy blockquote, not a chip; pastes stay literal.
    expect(promptTextContent('> one\nbelow').content?.[0]?.content?.[0]?.type).toBe('text')
    expect(promptTextContent('> one\n\n', { literal: true }).content?.[0]?.content?.[0]?.type).toBe(
      'text'
    )
  })

  it('shows an added quote as a chip and sends the same Markdown quote', async () => {
    const { input, editor, container } = setup('hi')
    const next = `hi\n\n${formatNativeChatQuote('quoted\nwords')}`
    act(() => {
      input.value = next
      input.setSelectionRange(next.length, next.length)
    })
    expect(input.value).toBe(next)
    expect(chips(editor)).toBe(1)
    // The chip reads "Quote: …" to a screen reader.
    await waitFor(() => expect(container.querySelector('.sr-only')?.textContent).toBe('Quote: '))
    expect(container.textContent).toContain('Quote: quoted words')
    expect(container.textContent).not.toContain('>')
  })

  it('keeps text typed after the chip on its line, and text typed before it on the line above', async () => {
    const { input, editor, container } = setup('> q\n\n')
    expect(chips(editor)).toBe(1)
    // Add to chat leaves the caret right after the chip.
    act(() => {
      input.setSelectionRange(input.value.length, input.value.length)
      editor.commands.insertContent('hello')
    })
    expect(input.value).toBe('> q\n\nhello')
    expect(editor.state.doc.childCount).toBe(1)
    // The chip keeps its name; the comment is plain text after it.
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror > p')?.textContent).toBe('Quote: qhello')
    )
    act(() => {
      editor.commands.setTextSelection(1)
      editor.commands.insertContent('above')
    })
    expect(input.value).toBe('above\n> q\n\nhello')
    // The caret stays after the typed text.
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5])
  })

  it('shows text written after a chip through the composer API on the chip line', () => {
    const { input, editor } = setup('> q\n\n')
    act(() => writeNativeChatComposerText(input, '> q\n\nhello', '> q\n\nhello'.length))
    expect(input.value).toBe('> q\n\nhello')
    const first = editor.state.doc.child(0)
    expect(first.childCount).toBe(2)
    expect(first.child(0).attrs.token).toBe('> q\n\n')
    expect(first.child(1).text).toBe('hello')
  })

  it('pastes quoted text literally', () => {
    const { input, editor } = setup()
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { getData: (format: string) => (format === 'text/plain' ? '> x\n\n' : '') }
    })
    expect(input.value).toBe('> x\n\n')
    expect(chips(editor)).toBe(0)
  })
})
