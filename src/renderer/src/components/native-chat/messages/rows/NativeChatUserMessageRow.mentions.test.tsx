// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TranslationScopeProvider } from '@/i18n/translation-scope-provider'
import { MessageRow } from './NativeChatMessageRow'
import { serializeNativeChatAgentReferences } from '../../composer/pickers/native-chat-agent-reference-send'
import { AgentReferencePillContent } from '../../composer/editor/native-chat-agent-reference'

afterEach(cleanup)

const chip = (label: string, kind: string, environment?: string) => ({
  type: 'nativeChatAgentReference',
  attrs: { label, address: 'orca_session_id:chat_aaaaaaaa', hostKey: 'local', kind, environment }
})

/** The text a send delivers for "ask <chip> now", made by the real serializer. */
function sentText(label: string, environment?: string): string {
  const token = `@${label} (Orca agent orca_session_id:chat_aaaaaaaa)`
  return serializeNativeChatAgentReferences(`ask ${token} now`, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'ask ' },
          chip(label, 'chat', environment),
          { type: 'text', text: ' now' }
        ]
      }
    ]
  })
}

/** The text of the chip the composer shows for a chat. */
function composerChip(label: string): string {
  const { container, unmount } = render(
    <AgentReferencePillContent label={label} kind="chat" selected={false} />,
    { wrapper: TranslationScopeProvider }
  )
  const text = container.textContent ?? ''
  unmount()
  return text
}

function bubble(text: string): HTMLElement {
  const { container } = render(
    <TooltipProvider>
      <MessageRow
        message={{
          id: 'sent',
          role: 'user',
          timestamp: 0,
          source: 'transcript',
          blocks: [{ type: 'text', text }]
        }}
        expandSignal={false}
        onScrollMessageToTop={vi.fn()}
      />
    </TooltipProvider>,
    { wrapper: TranslationScopeProvider }
  )
  return container.querySelector<HTMLElement>('.native-chat-markdown')!
}

it('shows a sent mention as its chip and hides the routing note the agent got', () => {
  const text = sentText('Tech "Lead"')
  // The agent text keeps the note.
  expect(text).toBe(
    'ask @Tech \\"Lead\\" now\n\n[Orca chat "Tech \\"Lead\\"": orca_session_id:chat_aaaaaaaa — message it with orca orchestration send --to orca_session_id:chat_aaaaaaaa --subject "<topic>" --body "<message>"]'
  )
  const shown = bubble(text)
  expect(shown.textContent).toBe(`ask ${composerChip('Tech "Lead"')} now`)
  expect(shown.querySelector('[data-slot="badge"]')).toHaveTextContent('Tech "Lead"')
})

it('shows a mention of a chat on another host as its chip, with no note', () => {
  const text = sentText('Lead on Box (box)', 'box')
  expect(text).toContain(' — message it with orca orchestration send --on box --to ')
  const shown = bubble(text)
  expect(shown.textContent).toBe('ask Chat Lead on Box (box) now')
  expect(shown.querySelector('[data-slot="badge"]')).toHaveTextContent('Lead on Box (box)')
})

it('shows a message with no note as before', () => {
  const shown = bubble('ask @Tech Lead now')
  expect(shown.textContent).toBe('ask @Tech Lead now')
  expect(shown.querySelector('[data-slot="badge"]')).toBeNull()
})

it('shows text that only looks like a note', () => {
  const lookalike =
    'ask @Tech Lead now\n\n[Orca chat "Tech Lead": orca_session_id:chat_aaaaaaaa — message it by mail]'
  expect(bubble(lookalike).textContent).toContain('message it by mail')
  cleanup()
  // A real note for an agent the text does not mention is not a send note either.
  const unmentioned = sentText('Tech Lead').replace('ask @Tech Lead now', 'ask now')
  expect(bubble(unmentioned).textContent).toContain('[Orca chat "Tech Lead"')
})
