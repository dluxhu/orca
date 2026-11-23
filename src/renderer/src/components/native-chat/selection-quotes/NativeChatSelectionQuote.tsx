import { useRef, type RefObject } from 'react'
import { useAppStore } from '../../../store/index'
import type { NativeChatComposerHandle } from '../composer/native-chat-composer-types'
import {
  formatNativeChatQuote,
  readNativeChatQuotableSelection
} from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import { readNativeChatTranscriptSelection } from './native-chat-transcript-selection'
import { SelectionAddToChatPopover } from './SelectionAddToChatPopover'
import { rememberNativeChatQuoteSource, type QuoteSource } from './native-chat-quote-sources'
import { quoteSourceOf } from './native-chat-quote-highlight'

function copyTranscriptSelectionOnSelect(root: HTMLElement): void {
  if (!useAppStore.getState().settings?.terminalClipboardOnSelect) {
    return
  }
  const text = readNativeChatTranscriptSelection(root)
  if (text) {
    // Swallowed like the terminal's copy on select: a failed copy leaves the selection to retry.
    void window.api.ui.writeClipboardText(text).catch(() => {})
  }
}

/** A box a selection is quoted into: chat's composer, or an item's comment box. */
export type NativeChatQuoteTarget = Pick<NativeChatComposerHandle, 'acceptsText' | 'appendText'> &
  Partial<Pick<NativeChatComposerHandle, 'insertQuote'>>

/** The quote target of a box built on chat's composer. */
export function composerQuoteTarget(
  composer: RefObject<NativeChatComposerHandle | null>
): NativeChatQuoteTarget {
  return {
    acceptsText: () => composer.current?.acceptsText() === true,
    appendText: (text, options) => composer.current?.appendText(text, options)
  }
}

/** Adds a transcript quote to the box, and remembers its message for the sent quote's jump.
 *  A box without `insertQuote` gets the quote as text. */
export function addTranscriptQuote(
  composer: NativeChatQuoteTarget | null,
  text: string,
  source: QuoteSource | null
): void {
  if (source) {
    rememberNativeChatQuoteSource(text, source)
  }
  const quote = formatNativeChatQuote(text)
  if (composer?.insertQuote) {
    composer.insertQuote(quote)
  } else {
    composer?.appendText(quote)
  }
}

export function NativeChatSelectionQuote({
  rootRef,
  composerRef,
  enabled
}: {
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatQuoteTarget | null>
  enabled: boolean
}): React.JSX.Element {
  const offeredSource = useRef<QuoteSource | null>(null)
  return (
    <SelectionAddToChatPopover
      rootRef={rootRef}
      enabled={enabled}
      readQuotable={(root) => {
        const quotable = composerRef.current?.acceptsText()
          ? readNativeChatQuotableSelection(root)
          : null
        offeredSource.current = quotable
          ? quoteSourceOf(quotable.sourceElement, quotable.range)
          : null
        return quotable
      }}
      onSelectionSettled={copyTranscriptSelectionOnSelect}
      onAdd={(text) => addTranscriptQuote(composerRef.current, text, offeredSource.current)}
    />
  )
}
