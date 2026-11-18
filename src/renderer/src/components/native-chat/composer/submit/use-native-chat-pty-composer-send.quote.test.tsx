// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const sends = vi.hoisted(() => ({ message: vi.fn() }))
vi.mock('../../session/terminal/send/native-chat-runtime-send', () => ({
  sendNativeChatMessage: sends.message,
  sendNativeChatTypedCommand: vi.fn(),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('../../session/terminal/send/native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: vi.fn()
}))
vi.mock('@/components/native-chat/telemetry/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn()
}))
vi.mock('../../../../store/index', () => {
  const state = { clearNativeChatLaunchDraft: vi.fn() }
  return { useAppStore: Object.assign(() => undefined, { getState: () => state }) }
})

import { formatNativeChatQuote } from '../../selection-quotes/native-chat-quote-selection'
import { rememberNativeChatQuoteSource } from '../../selection-quotes/native-chat-quote-sources'
import { useNativeChatPtyComposerSend } from './use-native-chat-pty-composer-send'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'

const REPLY: NativeChatMessage = {
  id: 'reply-1',
  role: 'assistant',
  blocks: [{ type: 'text', text: Array.from({ length: 100 }, () => 'alpha').join(' ') }],
  timestamp: null,
  source: 'transcript'
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it('sends a long quote of a reply in this chat shortened to the agent terminal', () => {
  const long = Array.from({ length: 100 }, () => 'alpha').join(' ')
  rememberNativeChatQuoteSource(long, { messageId: 'reply-1', place: null })
  const { result } = renderHook(() =>
    useNativeChatPtyComposerSend({
      agent: 'claude',
      draft: `${formatNativeChatQuote(long)}my comment`,
      draftScopeKey: 'tab-1:quote-short',
      imageAttachments: [],
      disabled: false,
      isDispatchingSessionOption: false,
      launchDraftResolved: true,
      resolveTarget: () => ({ ptyId: 'pty-1' }),
      classifySend: () => 'chat',
      sessionOptionsSurface: null,
      terminalTabId: 'tab-1',
      trackPendingSend: vi.fn(),
      setDraft: vi.fn(),
      setCaret: vi.fn(),
      clearSkillOrigin: vi.fn(),
      clearImageAttachments: vi.fn(),
      setNotice: vi.fn(),
      chatMessages: [REPLY]
    })
  )
  expect(result.current()).toBe(true)
  expect(sends.message).toHaveBeenCalledWith(
    'pty-1',
    expect.stringMatching(
      /^> (alpha ){12}alpha …\n> \(74 quoted words left out; the full text is in your earlier reply\)\n> … (alpha ){12}alpha\n\nmy comment$/
    ),
    expect.anything()
  )
})
