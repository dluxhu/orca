import { createContext, useCallback, useEffect, useLayoutEffect, type RefObject } from 'react'
import { nativeChatSlotIndexOf } from '../conversation/slots/native-chat-transcript-slot-selection'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'
import type { NativeChatNavigationRequest } from '../viewport/navigation/use-native-chat-transcript-navigation'
import type { useNativeChatHistoryJump } from '../viewport/navigation/use-native-chat-history-jump'
import { showQuotedText } from './native-chat-quote-highlight'
import type { NativeChatQuoteJumpDeps } from './native-chat-quote-sources'

export type NativeChatQuoteJump = NonNullable<NativeChatQuoteJumpDeps['jumpToMessage']>

/**
 * Scrolls to a loaded message, then gives the scroller to `show` until `show` returns true. After
 * about half a second it calls `notifyMissing`. False when the message is not here. Each later step
 * does nothing once `isCurrent` is false.
 */
export type NativeChatMessageReveal = (
  messageId: string,
  show: (scroller: HTMLElement) => boolean,
  isCurrent?: () => boolean,
  notifyMissing?: () => void
) => boolean

const ALWAYS_CURRENT = (): boolean => true

// About half a second: the landing draws a loaded row well before this.
const SOURCE_FRAMES = 30

/** The message reveal of each mounted transcript. Back and Forward use it to show a chat place. */
export const nativeChatMessageReveals = new Set<NativeChatMessageReveal>()

/** The transcript's jump to a quoted message; null outside a transcript. */
export const NativeChatQuoteJumpContext = createContext<NativeChatQuoteJump | null>(null)

/** Gives the scroller to `show` on each frame until `show` returns true, for about half a second. */
function showWhenDrawn(
  scrollRef: RefObject<HTMLDivElement | null>,
  show: (scroller: HTMLElement) => boolean,
  isCurrent: () => boolean,
  notifyMissing?: () => void
): void {
  // The landing scrolls in a layout effect; the row is drawn two frames later or more.
  let frame = 0
  const step = (): void => {
    if (!isCurrent()) {
      return
    }
    frame++
    const scroller = frame < 2 ? null : scrollRef.current
    if (scroller && show(scroller)) {
      return
    }
    if (frame < SOURCE_FRAMES) {
      requestAnimationFrame(step)
    } else {
      notifyMissing?.()
    }
  }
  requestAnimationFrame(step)
}

/**
 * Scrolls to the message as a rail jump does, then shows the quoted text in it. A chip pages a
 * message that is not loaded in from older history first, as a link to a message does.
 */
export function useNativeChatQuoteJump({
  slots,
  scrollRef,
  request,
  beginNavigation,
  readerLeavesEnd,
  startHistoryJump,
  sessionKey
}: {
  slots: readonly NativeChatTranscriptSlot[]
  scrollRef: RefObject<HTMLDivElement | null>
  request: Pick<NativeChatNavigationRequest, 'issue' | 'nextRequestId'>
  beginNavigation: () => void
  readerLeavesEnd: () => void
  startHistoryJump: ReturnType<typeof useNativeChatHistoryJump>['start']
  /** This chat; a source from another chat that is not loaded here pages nothing. */
  sessionKey: string
}): NativeChatQuoteJump {
  const { issue, nextRequestId } = request
  // "Add to chat" reads the chat of a quote from its transcript's scroller.
  useLayoutEffect(() => {
    scrollRef.current?.setAttribute('data-native-chat-quote-chat', sessionKey)
  })
  const reveal = useCallback<NativeChatMessageReveal>(
    (messageId, show, isCurrent = ALWAYS_CURRENT, notifyMissing) => {
      if (nativeChatSlotIndexOf(slots, messageId) === -1) {
        return false
      }
      beginNavigation()
      readerLeavesEnd()
      issue({ kind: 'rail', messageId, requestId: nextRequestId() })
      showWhenDrawn(scrollRef, show, isCurrent, notifyMissing)
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
    ({ messageId, place, chat }, text, notifyMissing, isCurrent, shown) => {
      const show = (scroller: HTMLElement): boolean => {
        // By the message id: a tool run's member rows use data-index too.
        const source = scroller.querySelector<HTMLElement>(
          `[data-native-chat-quote-source="${CSS.escape(messageId)}"]`
        )
        if (source) {
          showQuotedText(source, text, place)
          shown?.()
        }
        return Boolean(source)
      }
      if (reveal(messageId, show, isCurrent, notifyMissing)) {
        return true
      }
      // A loaded message is here whatever its chat; the chat only rules out paging this chat.
      if (chat !== undefined && chat !== sessionKey) {
        return false
      }
      // A long chat keeps only its latest messages loaded, for example after a send. The link landing
      // takes the reader off the end. Back and Forward do not page: they ask each transcript.
      beginNavigation()
      startHistoryJump({ kind: 'item', id: messageId }, (result) => {
        if (result === 'landed') {
          showWhenDrawn(scrollRef, show, isCurrent, notifyMissing)
        } else if (result === 'missing' && isCurrent()) {
          notifyMissing()
        }
      })
      return true
    },
    [beginNavigation, reveal, scrollRef, sessionKey, startHistoryJump]
  )
}
