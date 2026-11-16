// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import {
  writeNativeChatComposerText,
  type NativeChatComposerInput
} from './native-chat-composer-input'
import { promptEditor } from './native-chat-prompt-editor.test-support'
import { promptTextContent, QUOTE_NODE } from './native-chat-prompt-document-text'

afterEach(cleanup)

/** Each line's chip token, or null for a line without a chip. */
function chipLines(doc: JSONContent): (string | null)[] {
  return (doc.content ?? []).map((block) =>
    block.content?.length === 1 && block.content[0].type === QUOTE_NODE
      ? String(block.content[0].attrs?.token)
      : (block.content ?? []).some((node) => node.type === QUOTE_NODE)
        ? 'MIXED'
        : null
  )
}

// Programmatic writes: the composer API, root key routing and dictation all set the value.
it.each([
  ['text after a chip', '> q\n\n', '> q hello\n\n'],
  ['a line on the blank line below a chip', '> q\n\nbelow', '> q\nx\n\nbelow'],
  ['removing the blank line below a chip', '> q\n\nbelow', '> q\nbelow'],
  ['text before a chip', '> q\n\n', 'x> q\n\n'],
  ['a dictated word above a chip', 'hi\n> q\n\n', 'hi there\n> q\n\n'],
  ['a quote line below a chip', '> a\n\n', '> a\n> b\n\n'],
  ['a quote line above a chip', 'top\n\n> a\n\n', 'top\n> z\n> a\n\n'],
  ['a blank line inside a quote run', 'top\n> a\n> b\n\n', 'top\n> a\n\n> b\n\n'],
  ['a blank line that closes a quote run', 'p\n> a\n> b\n> c\nz', 'p\n> a\n> b\n> c\n'],
  [
    'a quote line above a quote run that text closes',
    'z\n> b\n> c\n> d\nq',
    '> a\n> b\n> c\n> d\nq'
  ]
])('after %s, the chips are what the sent text parses to', (_name, before, after) => {
  const inputRef = createRef<NativeChatComposerInput>()
  render(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={before}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  const input = inputRef.current!
  const editor = promptEditor(screen.getByRole('textbox'))
  // At the end: a caret inside a chip's text snaps to the chip's edge.
  const caret = after.length
  act(() => writeNativeChatComposerText(input, after, caret))
  expect(input.value).toBe(after)
  expect(chipLines(editor.getJSON())).toEqual(chipLines(promptTextContent(after)))
  expect([input.selectionStart, input.selectionEnd]).toEqual([caret, caret])
})
