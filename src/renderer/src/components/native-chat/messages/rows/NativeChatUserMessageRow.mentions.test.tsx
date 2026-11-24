// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { openOrchestrationDispatch } from '@/lib/agent-session/open/open-agent-message-sender'
import {
  NativeChatVisualOwnerContext,
  type NativeChatVisualOwner
} from '../../media/visuals/native-chat-visual-owner'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TranslationScopeProvider } from '@/i18n/translation-scope-provider'
import { showChatOpenUnavailable } from '@/lib/agent-session/open/chat-open-failure-toast'
import { MessageRow } from './NativeChatMessageRow'
import { serializeNativeChatAgentReferences } from '../../composer/pickers/native-chat-agent-reference-send'
import { AgentReferencePillContent } from '../../composer/editor/native-chat-agent-reference'
import { NativeChatQuoteJumpContext } from '../../selection-quotes/use-native-chat-quote-jump'
import { rememberNativeChatQuoteSource } from '../../selection-quotes/native-chat-quote-sources'
import { formatNativeChatQuote } from '../../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import { agentReferenceNote } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/agent-session/open/open-agent-message-sender', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openOrchestrationDispatch: vi.fn(async () => {})
}))
vi.mock('@/lib/agent-session/open/chat-open-failure-toast', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showChatOpenUnavailable: vi.fn()
}))

const initialStore = useAppStore.getState()

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
  useAppStore.setState(initialStore, true)
})

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

type Part = string | { label: string; kind: string; address: string }

/** The text a send delivers for a draft of text and chips, made by the real serializer. */
function send(parts: Part[], layout: 'message' | 'goal' = 'message'): string {
  const text = parts
    .map((part) =>
      typeof part === 'string' ? part : `@${part.label} (Orca agent ${part.address})`
    )
    .join('')
  const content = parts.map((part) =>
    typeof part === 'string'
      ? { type: 'text', text: part }
      : { type: 'nativeChatAgentReference', attrs: { ...part, hostKey: 'local' } }
  )
  return serializeNativeChatAgentReferences(
    text,
    { type: 'doc', content: [{ type: 'paragraph', content }] },
    {},
    layout
  )
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

/** The badge text of the chip the composer shows for a terminal. */
function composerTerminalBadge(label: string): string {
  const { container, unmount } = render(
    <AgentReferencePillContent label={label} kind="terminal" selected={false} />,
    { wrapper: TranslationScopeProvider }
  )
  const text = container.querySelector('[data-slot="badge"]')?.textContent ?? ''
  unmount()
  return text
}

const owner = (target: RuntimeClientTarget): NativeChatVisualOwner => ({
  target,
  sessionId: 'this-chat',
  worktreeId: 'workspace'
})
const LOCAL_CHAT = owner({ kind: 'local' })
const ENV_A_CHAT = owner({ kind: 'environment', environmentId: 'env-a' })

function bubble(text: string, sentAs?: 'goal', chat?: NativeChatVisualOwner): HTMLElement {
  const row = (
    <TooltipProvider>
      <MessageRow
        message={{
          id: 'sent',
          role: 'user',
          timestamp: 0,
          source: 'transcript',
          blocks: [{ type: 'text', text }],
          ...(sentAs ? { sentAs } : {})
        }}
        expandSignal={false}
        onScrollMessageToTop={vi.fn()}
      />
    </TooltipProvider>
  )
  const { container } = render(
    chat ? (
      <NativeChatVisualOwnerContext.Provider value={chat}>
        {row}
      </NativeChatVisualOwnerContext.Provider>
    ) : (
      row
    ),
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
  expect(shown.textContent).toBe(`ask ${composerChip('Lead on Box (box)')} now`)
  expect(shown.querySelector('[data-slot="badge"]')).toHaveTextContent('Lead on Box (box)')
})

it('hides the notes of a goal, which follow the text on the same line', () => {
  const text = send(
    ['do it ', { label: 'A', kind: 'chat', address: 'orca_session_id:chat_aaaaaaaa' }],
    'goal'
  )
  expect(text).toMatch(/^do it @A \[Orca chat "A": [^\n]+\]$/)
  expect(bubble(text, 'goal').textContent).toBe(`do it ${composerChip('A')}`)
})

it('makes a label that starts with another label one chip', () => {
  const shown = bubble(
    send([
      'ask ',
      { label: 'A', kind: 'terminal', address: 'term_a1' },
      ' and ',
      { label: 'AB', kind: 'terminal', address: 'term_b2' },
      ' now'
    ])
  )
  const badges = [...shown.querySelectorAll('[data-slot="badge"]')]
  expect(badges.map((badge) => badge.textContent)).toEqual([
    composerTerminalBadge('A'),
    composerTerminalBadge('AB')
  ])
  expect(shown.textContent).not.toContain('@')
})

it('makes a label with brackets one chip', () => {
  const shown = bubble(sentText('[WIP] fix'))
  expect(shown.textContent).toBe(`ask ${composerChip('[WIP] fix')} now`)
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

// Both chips draw in one sent message: the mention from its routing note, the quote from its lines.
it('draws a quote chip and a mention chip in one sent message, and the quote still jumps', () => {
  rememberNativeChatQuoteSource('the quoted words', { messageId: 'reply-1', place: null })
  const text = `${formatNativeChatQuote('the quoted words')}${send([
    'ask ',
    { label: 'A', kind: 'chat', address: 'orca_session_id:chat_aaaaaaaa' },
    ' now'
  ])}`
  const jump = vi.fn(() => true)
  render(
    <TooltipProvider>
      <NativeChatQuoteJumpContext.Provider value={jump}>
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
      </NativeChatQuoteJumpContext.Provider>
    </TooltipProvider>,
    { wrapper: TranslationScopeProvider }
  )
  const shown = document.querySelector<HTMLElement>('.native-chat-markdown')!
  expect(shown.querySelector('[data-slot="badge"]')).toHaveTextContent('A')
  fireEvent.click(screen.getByRole('button', { name: /^Quote: the quoted words/ }))
  expect(jump).toHaveBeenCalledTimes(1)
  // The jump can get more arguments after the source and the text.
  expect(jump.mock.calls[0].slice(0, 2)).toEqual([
    { messageId: 'reply-1', place: null },
    'the quoted words'
  ])
})

it('opens the mentioned chat on the chat host when its chip is clicked', async () => {
  bubble(sentText('Tech Lead'), undefined, ENV_A_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Tech Lead' }))

  expect(openOrchestrationDispatch).toHaveBeenCalledWith(
    'orca_session_id:chat_aaaaaaaa',
    'Tech Lead',
    { kind: 'environment', environmentId: 'env-a' },
    expect.anything()
  )
})

it("opens a mention on another host through this window's environment of that name", async () => {
  useAppStore.setState({
    runtimeEnvironments: [{ id: 'env-box', name: 'box' }] as never
  })
  bubble(sentText('Lead on Box (box)', 'box'), undefined, LOCAL_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Lead on Box (box)' }))

  expect(openOrchestrationDispatch).toHaveBeenCalledWith(
    'orca_session_id:chat_aaaaaaaa',
    'Lead on Box (box)',
    { kind: 'environment', environmentId: 'env-box' },
    expect.anything()
  )
})

it('says so when this window does not know the host of the mention', async () => {
  bubble(sentText('Lead on Box (box)', 'box'), undefined, LOCAL_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Lead on Box (box)' }))

  expect(openOrchestrationDispatch).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('not connected'))
})

it('says so in a short notice when the mentioned chat is gone', async () => {
  bubble(sentText('Tech Lead'), undefined, LOCAL_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Tech Lead' }))
  // The open path reports a gone chat through the feedback it is given.
  const feedback = vi.mocked(openOrchestrationDispatch).mock.calls[0]?.[3]
  feedback?.open?.gone('Tech Lead')

  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('no longer on this host'))
  expect(toast.error).not.toHaveBeenCalled()
})

it('shows the shared chat open toast when the mentioned chat does not open', async () => {
  bubble(sentText('Tech Lead'), undefined, LOCAL_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Tech Lead' }))
  const feedback = vi.mocked(openOrchestrationDispatch).mock.calls[0]?.[3]
  const context = { detail: 'session_not_found', retry: vi.fn() }
  feedback?.open?.unavailable('Tech Lead', context)

  expect(showChatOpenUnavailable).toHaveBeenCalledWith(context, 'Tech Lead')
  expect(toast.info).not.toHaveBeenCalled()
})

it('keeps a crew mention a plain chip', () => {
  const shown = bubble(
    `ask @Crew now\n\n${agentReferenceNote('Crew', 'dispatch:ctx_1')}`,
    undefined,
    LOCAL_CHAT
  )

  expect(shown.querySelector('[data-slot="badge"]')).toHaveTextContent('Crew')
  expect(screen.queryByRole('button', { name: 'Open Crew' })).toBeNull()
})

it("says so for a mention from a chat on another host, which names that host's environments", async () => {
  useAppStore.setState({
    runtimeEnvironments: [{ id: 'env-box', name: 'box' }] as never
  })
  bubble(sentText('Lead on Box (box)', 'box'), undefined, ENV_A_CHAT)

  await userEvent.click(screen.getByRole('button', { name: 'Open Lead on Box (box)' }))

  expect(openOrchestrationDispatch).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('not connected'))
})

it('opens the terminal of a plain shell mention', async () => {
  bubble(
    send(['ask ', { label: 'Shell', kind: 'shell', address: 'term_b2' }, ' now']),
    undefined,
    LOCAL_CHAT
  )

  await userEvent.click(screen.getByRole('button', { name: 'Open Shell' }))

  expect(openOrchestrationDispatch).toHaveBeenCalledWith(
    'term_b2',
    'Shell',
    { kind: 'local' },
    expect.anything()
  )
})
