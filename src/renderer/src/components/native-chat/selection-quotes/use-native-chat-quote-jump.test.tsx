// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const shown = vi.hoisted(() => vi.fn())
vi.mock('./native-chat-quote-highlight', () => ({ showQuotedText: shown }))

import { useNativeChatQuoteJump } from './use-native-chat-quote-jump'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
})

afterEach(() => {
  vi.useRealTimers()
  shown.mockReset()
})

function jump(scroller: HTMLDivElement) {
  const issue = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the jump reads only each slot's kind and message id.
  const slots = [
    { kind: 'message', message: { id: 'reply-0' } },
    { kind: 'message', message: { id: 'reply-1' } }
  ] as unknown as NativeChatTranscriptSlot[]
  const { result } = renderHook(() =>
    useNativeChatQuoteJump({
      slots,
      scrollRef: { current: scroller },
      request: { issue, nextRequestId: () => 7 },
      beginNavigation: vi.fn(),
      readerLeavesEnd: vi.fn()
    })
  )
  return { issue, jumpTo: result.current }
}

it('scrolls to the quoted message as a rail jump does, then shows the text in it', () => {
  const scroller = document.createElement('div')
  scroller.innerHTML =
    '<div data-index="0"><div data-native-chat-quote-source="reply-0">Another reply.</div></div>' +
    '<div data-index="1"><div data-native-chat-quote-source="reply-1">The quoted text.</div></div>'
  const { issue, jumpTo } = jump(scroller)
  const place = { offset: 4, length: 11, hash: 'h' }
  const notifyMissing = vi.fn()
  expect(jumpTo({ messageId: 'missing', place: null }, 'x', notifyMissing)).toBe(false)
  expect(issue).not.toHaveBeenCalled()
  expect(jumpTo({ messageId: 'reply-1', place }, 'quoted text', notifyMissing)).toBe(true)
  expect(issue).toHaveBeenCalledWith({ kind: 'rail', messageId: 'reply-1', requestId: 7 })
  vi.advanceTimersToNextFrame()
  vi.advanceTimersToNextFrame()
  expect(shown).toHaveBeenCalledWith(
    scroller.querySelector('[data-native-chat-quote-source="reply-1"]'),
    'quoted text',
    place
  )
  expect(notifyMissing).not.toHaveBeenCalled()
})

it('shows the text when the message is drawn late, and a notice when it is never drawn', () => {
  const scroller = document.createElement('div')
  const { jumpTo } = jump(scroller)
  const notifyMissing = vi.fn()
  jumpTo({ messageId: 'reply-1', place: null }, 'quoted text', notifyMissing)
  for (let frame = 0; frame < 5; frame++) {
    vi.advanceTimersToNextFrame()
  }
  scroller.innerHTML = '<div data-native-chat-quote-source="reply-1">The quoted text.</div>'
  vi.advanceTimersToNextFrame()
  expect(shown).toHaveBeenCalledOnce()
  jumpTo({ messageId: 'reply-0', place: null }, 'other text', notifyMissing)
  for (let frame = 0; frame < 30; frame++) {
    vi.advanceTimersToNextFrame()
  }
  expect(shown).toHaveBeenCalledOnce()
  expect(notifyMissing).toHaveBeenCalledOnce()
})
