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
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from '../../drafts/native-chat-composer-draft-store'
import { insertNativeChatComposerDraftText } from '../../drafts/native-chat-composer-draft-insertion'
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

it('keeps the chips of a hidden draft after dictation joins a quote line', () => {
  updateNativeChatComposerDraft(
    'dictated-draft',
    { text: '> q', document: promptTextContent('> q') },
    'immediate'
  )
  insertNativeChatComposerDraftText('dictated-draft', 'hello', { dictated: true, draftOnly: true })
  const draft = readNativeChatComposerDraft('dictated-draft')
  expect(draft.text).toBe('> q hello')
  expect(chipLines(draft.document!)).toEqual(chipLines(promptTextContent(draft.text)))
})

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
    expect(chipLines(editor.getJSON())).toEqual(chipLines(promptTextContent(text)))
  }
)

it('keeps a line with a file pill as a line that ends a quote run', () => {
  const inputRef = createRef<NativeChatComposerInput>()
  render(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={'> a\nb\n'}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  const input = inputRef.current!
  const editor = promptEditor(screen.getByRole('textbox'))
  act(() => {
    input.setSelectionRange(4, 5)
    input.insertFileReferences!(['/x/f.txt'])
  })
  const before = input.value
  expect(before).toBe('> a\n@/x/f.txt b\n')
  act(() => writeNativeChatComposerText(input, `> aa${before.slice(3)}`, 4))
  expect(input.value).toBe(`> aa${before.slice(3)}`)
  expect(chipLines(editor.getJSON())).toEqual([null, null, null])
  expect(editor.getJSON().content?.[1]?.content?.[0]?.type).toBe('nativeChatFileReference')
})
