// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const shown = vi.hoisted(() => vi.fn())
vi.mock('./native-chat-quote-highlight', () => ({ showQuotedText: shown }))

import { useNativeChatQuoteJump } from './use-native-chat-quote-jump'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'

afterEach(() => {
  vi.useRealTimers()
  shown.mockReset()
})

it('scrolls to the quoted message as a rail jump does, then shows the text in it', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
  const scroller = document.createElement('div')
  // A tool run's member rows also number themselves with data-index.
  scroller.innerHTML =
    '<div data-index="0"><div data-index="1">a tool step</div></div>' +
    '<div data-index="1"><div data-native-chat-quote-source="reply-1">The quoted text.</div></div>'
  const issue = vi.fn()
  const place = { offset: 4, length: 11, hash: 'h' }
  const beginNavigation = vi.fn()
  const readerLeavesEnd = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the jump reads only each slot's kind and message id.
  const slots = [
    { kind: 'message', message: { id: 'prompt' } },
    { kind: 'message', message: { id: 'reply-1' } }
  ] as unknown as NativeChatTranscriptSlot[]
  const { result } = renderHook(() =>
    useNativeChatQuoteJump({
      slots,
      scrollRef: { current: scroller },
      request: { issue, nextRequestId: () => 7 },
      beginNavigation,
      readerLeavesEnd
    })
  )
  expect(result.current({ messageId: 'missing', place: null }, 'x')).toBe(false)
  expect(issue).not.toHaveBeenCalled()
  expect(result.current({ messageId: 'reply-1', place }, 'quoted text')).toBe(true)
  expect(beginNavigation).toHaveBeenCalledOnce()
  expect(readerLeavesEnd).toHaveBeenCalledOnce()
  expect(issue).toHaveBeenCalledWith({ kind: 'rail', messageId: 'reply-1', requestId: 7 })
  expect(shown).not.toHaveBeenCalled()
  vi.advanceTimersToNextFrame()
  vi.advanceTimersToNextFrame()
  expect(shown).toHaveBeenCalledWith(
    scroller.querySelector('[data-native-chat-quote-source="reply-1"]'),
    'quoted text',
    place
  )
})
