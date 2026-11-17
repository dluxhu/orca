import { createContext, useCallback, useEffect, type RefObject } from 'react'
import { nativeChatSlotIndexOf } from '../conversation/slots/native-chat-transcript-slot-selection'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'
import type { NativeChatNavigationRequest } from '../viewport/navigation/use-native-chat-transcript-navigation'
import { showQuotedText } from './native-chat-quote-highlight'
import type { QuoteSource } from './native-chat-quote-sources'

export type NativeChatQuoteJump = (source: QuoteSource, text: string) => boolean

/** Scrolls to a loaded message, then gives the scroller to `show`; false when the message is not here. */
export type NativeChatMessageReveal = (
  messageId: string,
  show: (scroller: HTMLElement) => void
) => boolean

/** The message reveal of each mounted transcript. Back and Forward use it to show a chat place. */
export const nativeChatMessageReveals = new Set<NativeChatMessageReveal>()

/** The transcript's jump to a quoted message; null outside a transcript. */
export const NativeChatQuoteJumpContext = createContext<NativeChatQuoteJump | null>(null)

/** Scrolls to a loaded message as a rail jump does, then shows the quoted text in it. */
export function useNativeChatQuoteJump({
  slots,
  scrollRef,
  request,
  beginNavigation,
  readerLeavesEnd
}: {
  slots: readonly NativeChatTranscriptSlot[]
  scrollRef: RefObject<HTMLDivElement | null>
  request: Pick<NativeChatNavigationRequest, 'issue' | 'nextRequestId'>
  beginNavigation: () => void
  readerLeavesEnd: () => void
}): NativeChatQuoteJump {
  const { issue, nextRequestId } = request
  const reveal = useCallback<NativeChatMessageReveal>(
    (messageId, show) => {
      if (nativeChatSlotIndexOf(slots, messageId) === -1) {
        return false
      }
      beginNavigation()
      readerLeavesEnd()
      issue({ kind: 'rail', messageId, requestId: nextRequestId() })
      // The landing scrolls in a layout effect; the row is drawn two frames later.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            show(scrollRef.current)
          }
        })
      )
      return true
    },
    [beginNavigation, issue, nextRequestId, readerLeavesEnd, scrollRef, slots]
  )
  useEffect(() => {
    nativeChatMessageReveals.add(reveal)
    return () => {
      nativeChatMessageReveals.delete(reveal)
    }
  }, [reveal])
  return useCallback(
    ({ messageId, place }, text) =>
      reveal(messageId, (scroller) => {
        // By the message id: a tool run's member rows use data-index too.
        const source = scroller.querySelector<HTMLElement>(
          `[data-native-chat-quote-source="${CSS.escape(messageId)}"]`
        )
        if (source) {
          showQuotedText(source, text, place)
        }
      }),
    [reveal]
  )
}
