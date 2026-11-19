// @vitest-environment happy-dom
import { render, renderHook, act } from '@testing-library/react'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentReferencePillContent,
  insertAgentReferences,
  NativeChatAgentReference
} from '../editor/native-chat-agent-reference'
import type { NativeChatComposerInput } from '../editor/native-chat-composer-input'
import { promptText, promptTextOffset } from '../editor/native-chat-prompt-document'
import { promptTextContent } from '../editor/native-chat-prompt-document-text'
import { serializeNativeChatAgentReferences } from './native-chat-agent-reference-send'
import {
  completeNativeChatMention,
  nativeChatMentionSessionValue,
  type NativeChatMentionSession
} from './native-chat-mentions'
import { NativeChatMentionLabel } from './NativeChatMentionLabel'
import { useNativeChatMentionRowKeeper } from './use-native-chat-mention-row-keeper'

const session = {
  kind: 'chat' as const,
  label: 'Release notes',
  address: 'orca_session_id:chat_aaaaaaaa',
  hostKey: 'local',
  detail: 'repo/main'
}

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

// The same text glue NativeChatPromptEditor gives the composer.
type PickInput = Pick<NativeChatComposerInput, 'value' | 'selectionStart' | 'insertAgentReferences'>

function composer(text: string): { editor: Editor; input: PickInput } {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, NativeChatAgentReference],
    content: promptTextContent(text)
  })
  editors.push(editor)
  editor.commands.focus('end')
  const input: PickInput = {
    get value() {
      return promptText(editor.state.doc)
    },
    get selectionStart() {
      return promptTextOffset(editor.state.doc, editor.state.selection.from)
    },
    insertAgentReferences: (references, replace) =>
      insertAgentReferences(editor, references, replace)
  }
  return { editor, input }
}

function pick(input: PickInput, item: NativeChatMentionSession) {
  const commit = vi.fn()
  completeNativeChatMention(input, item, [input.value, input.selectionStart ?? 0], commit)
  return commit
}

const chips = (editor: Editor) =>
  (editor.getJSON().content?.[0]?.content ?? []).filter(
    (node) => node.type === 'nativeChatAgentReference'
  )

describe('picking a session from the @ menu', () => {
  it('puts a chat chip where the token was, and the send note names orca chat', () => {
    const { editor, input } = composer('ask @rel')
    const commit = pick(input, session)
    expect(input.value).not.toContain('@rel')
    expect(commit).toHaveBeenCalledWith({ draft: input.value, caret: input.selectionStart })
    expect(chips(editor)).toEqual([
      expect.objectContaining({ attrs: expect.objectContaining({ kind: 'chat' }) })
    ])
    expect(serializeNativeChatAgentReferences(input.value, editor.getJSON())).toContain(
      'orca chat send --session chat_aaaaaaaa --text <message>'
    )
  })

  it('keeps the typed token when the session is already a chip', () => {
    const { editor, input } = composer('ask @rel')
    pick(input, session)
    editor.commands.insertContent('@rel')
    const before = input.value
    const commit = pick(input, session)
    expect(commit).not.toHaveBeenCalled()
    expect(input.value).toBe(before)
    expect(input.value.endsWith('@rel')).toBe(true)
    expect(chips(editor)).toHaveLength(1)
  })
})

describe('mention rows that arrive with no edit', () => {
  function useRows(items: string[], editKey: string) {
    const [active, setActive] = useState(0)
    useNativeChatMentionRowKeeper(items, editKey, setActive)
    return { active, setActive }
  }

  it('keep the highlighted row until the next edit', () => {
    const row = nativeChatMentionSessionValue(session)
    const initialProps: { items: string[]; editKey: string } = {
      items: ['a.ts', 'b.ts'],
      editKey: '1'
    }
    const view = renderHook(({ items, editKey }) => useRows(items, editKey), { initialProps })
    act(() => view.result.current.setActive(1))
    view.rerender({ items: [row, 'a.ts', 'b.ts'], editKey: '1' })
    expect(view.result.current.active).toBe(2)
    act(() => view.result.current.setActive(0))
    view.rerender({ items: ['b.ts', row], editKey: '2' })
    expect(view.result.current.active).toBe(0)
  })
})

describe('what a screen reader hears', () => {
  it('names a session row by name, kind and workspace', () => {
    const row = render(
      <button type="button">
        <NativeChatMentionLabel item={session} />
      </button>
    )
    expect(row.getByRole('button').textContent).toBe('Release notes Chat · repo/main')
    expect(row.getByRole('button', { name: 'Release notes Chat repo/main' })).toBeTruthy()
  })

  it('says the kind of a chat or terminal chip', () => {
    const spoken = (view: ReturnType<typeof render>) =>
      view.container.querySelector('.sr-only')?.textContent
    const chat = render(
      <AgentReferencePillContent label="Release notes" kind="chat" selected={false} />
    )
    expect(spoken(chat)).toBe('Chat: Release notes')
    const terminal = render(
      <AgentReferencePillContent label="Runner" kind="terminal" selected={false} />
    )
    expect(spoken(terminal)).toBe('Terminal: Runner')
    const crew = render(<AgentReferencePillContent label="Worker" kind={null} selected={false} />)
    expect(spoken(crew)).toBe('Agent: Worker')
  })
})
