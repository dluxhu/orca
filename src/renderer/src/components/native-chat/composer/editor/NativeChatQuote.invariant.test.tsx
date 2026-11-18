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
import { QUOTE_NODE } from './native-chat-prompt-document-text'
import { updateNativeChatComposerDraft } from '../../drafts/native-chat-composer-draft-store'
import { clearNativeChatComposerDraftsForTests } from '../../drafts/native-chat-draft-reset'

afterEach(() => {
  cleanup()
  clearNativeChatComposerDraftsForTests()
})

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
  ['text after a chip', '> q\n\n', '> q hello\n\n', ['> q hello', null, null]],
  ['a quote line below a chip', '> a\n\n', '> a\n> b\n\n', ['> a\n> b', null, null]],
  [
    'a blank line that closes a quote run',
    'p\n> a\n> b\n> c\nz',
    'p\n> a\n> b\n> c\n',
    [null, '> a\n> b\n> c', null]
  ]
])('after %s, the chips are what the sent text parses to', (_name, before, after, lines) => {
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
  expect(chipLines(editor.getJSON())).toEqual(lines)
  expect([input.selectionStart, input.selectionEnd]).toEqual([caret, caret])
})

const MIXED: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: QUOTE_NODE, attrs: { token: '> q' } },
        { type: 'text', text: ' hello' }
      ]
    },
    { type: 'paragraph' },
    { type: 'paragraph' }
  ]
}

it.each(['mount', 'value'])(
  'loads a stored draft with a mixed chip line as the chips its text has (%s)',
  (path) => {
    const scopeKey = `mixed-${path}`
    const text = '> q hello\n\n'
    const inputRef = createRef<NativeChatComposerInput>()
    if (path === 'mount') {
      updateNativeChatComposerDraft(scopeKey, { text, document: MIXED }, 'immediate')
    }
    render(
      <NativeChatPromptEditor
        scopeKey={scopeKey}
        inputRef={inputRef}
        initialValue={path === 'mount' ? text : 'x'}
        disabled={false}
        placeholder="Message"
        onChange={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    if (path === 'value') {
      updateNativeChatComposerDraft(scopeKey, { text, document: MIXED }, 'immediate')
      act(() => {
        inputRef.current!.value = text
      })
    }
    expect(inputRef.current!.value).toBe(text)
    const editor = promptEditor(screen.getByRole('textbox'))
    expect(chipLines(editor.getJSON())).toEqual(['> q hello', null, null])
  }
)
