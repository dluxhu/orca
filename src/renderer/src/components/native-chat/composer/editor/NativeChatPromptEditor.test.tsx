// @vitest-environment happy-dom
import { createRef } from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'

afterEach(cleanup)

function editor(placeholder: string) {
  return (
    <NativeChatPromptEditor
      inputRef={createRef<NativeChatComposerInput>()}
      initialValue=""
      disabled={false}
      placeholder={placeholder}
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
}

describe('native chat prompt editor', () => {
  it('names the text box after the current placeholder', () => {
    const { rerender, container } = render(editor('Message'))
    const textbox = within(container).getByRole('textbox')
    expect(textbox.getAttribute('aria-label')).toBe('Message')
    rerender(editor('Message, ⌘ Enter to send'))
    expect(textbox.getAttribute('aria-label')).toBe('Message, ⌘ Enter to send')
  })
})
