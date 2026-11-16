// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'
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
  it('reads quoted lines closed by a blank line as one chip on its own line', () => {
    const doc = promptTextContent('above\n> one\n>\n> two\n\nbelow')
    expect(doc.content?.map((block) => block.content?.[0]?.type)).toEqual([
      'text',
      'nativeChatQuote',
      undefined,
      'text'
    ])
    expect(doc.content?.[1]?.content?.[0]?.attrs?.token).toBe('> one\n>\n> two')
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
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Quote: quoted\nwords"]')).not.toBeNull()
    )
    expect(container.textContent).not.toContain('>')
  })

  it('keeps text typed before or after the chip on its own line', () => {
    const { input, editor } = setup('> q\n\n')
    expect(chips(editor)).toBe(1)
    act(() => {
      editor.commands.setTextSelection(1)
      editor.commands.insertContent('above')
    })
    expect(input.value).toBe('above\n> q\n\n')
    // The caret stays after the typed text, not on the chip's line.
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5])
    act(() => {
      editor.commands.insertContent('!')
    })
    expect(input.value).toBe('above!\n> q\n\n')
    act(() => {
      input.setSelectionRange('above!\n> q'.length, 'above!\n> q'.length)
      editor.commands.insertContent('below')
    })
    expect(input.value).toBe('above!\n> q\n\nbelow\n\n')
    act(() => {
      editor.commands.insertContent('?')
    })
    expect(input.value).toBe('above!\n> q\n\nbelow?\n\n')
  })

  it('keeps a blank line between the chip and the text below it', () => {
    const { input, editor } = setup('> q\n\nbelow')
    act(() => {
      input.setSelectionRange(4, 4)
      editor.commands.joinBackward()
    })
    expect(input.value).toBe('> q\n\nbelow')
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
