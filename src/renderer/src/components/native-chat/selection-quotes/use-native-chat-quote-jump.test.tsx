// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const shown = vi.hoisted(() => vi.fn())
vi.mock('./native-chat-quote-highlight', () => ({ showQuotedText: shown }))

import { useNativeChatQuoteJump } from './use-native-chat-quote-jump'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'
import type { NativeChatNavigationRequest } from '../viewport/navigation/use-native-chat-transcript-navigation'

afterEach(() => {
  vi.useRealTimers()
  shown.mockReset()
})

it('scrolls to the quoted message as a rail jump does, then shows the text in it', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
  const scroller = document.createElement('div')
  scroller.innerHTML =
    '<div data-index="1"><div data-native-chat-quote-source="reply-1">The quoted text.</div></div>'
  const issue = vi.fn()
  const beginNavigation = vi.fn()
  const readerLeavesEnd = vi.fn()
  const slots = [
    { kind: 'message', message: { id: 'prompt' } },
    { kind: 'message', message: { id: 'reply-1' } }
  ] as unknown as NativeChatTranscriptSlot[]
  const { result } = renderHook(() =>
    useNativeChatQuoteJump({
      slots,
      scrollRef: { current: scroller },
      request: { issue, nextRequestId: () => 7 } as unknown as NativeChatNavigationRequest,
      beginNavigation,
      readerLeavesEnd
    })
  )
  expect(result.current('missing', 'x')).toBe(false)
  expect(issue).not.toHaveBeenCalled()
  expect(result.current('reply-1', 'quoted text')).toBe(true)
  expect(beginNavigation).toHaveBeenCalledOnce()
  expect(readerLeavesEnd).toHaveBeenCalledOnce()
  expect(issue).toHaveBeenCalledWith({ kind: 'rail', messageId: 'reply-1', requestId: 7 })
  expect(shown).not.toHaveBeenCalled()
  vi.advanceTimersToNextFrame()
  vi.advanceTimersToNextFrame()
  expect(shown).toHaveBeenCalledWith(
    scroller.querySelector('[data-native-chat-quote-source="reply-1"]'),
    'quoted text'
  )
})
