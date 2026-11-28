// What the chips in an item's Activity need: the quote chip's jump back into the Activity, and the
// host a mentioned chat or terminal opens on.
import { useCallback, type ReactNode } from 'react'
import type { Bot } from '../../../../../shared/bot-types'
import {
  NativeChatQuoteJumpContext,
  type NativeChatQuoteJump
} from '../../native-chat/selection-quotes/use-native-chat-quote-jump'
import { NativeChatAgentMentionHostContext } from '../../native-chat/markdown/native-chat-agent-mentions'
import { showQuotedText } from '../../native-chat/selection-quotes/native-chat-quote-highlight'
import { botHostTarget } from '@/lib/bot-hosts'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { botItemCommentDraftScope } from './bot-item-comment-draft'

/** The Activity's quote source: the list carries it, so a quote may span entries. */
export function botItemActivityQuoteSource(bot: Bot, itemUid: string): string {
  return botItemCommentDraftScope(bot, itemUid)
}

/** Mentioned chats and terminals open on the bot's host (one cached target per host); an SSH-hosted
 *  bot has none in this app. */
function mentionHostOf(bot: Bot): RuntimeClientTarget | null {
  try {
    return botHostTarget(bot.hostId)
  } catch {
    return null
  }
}

export function BotItemActivityChips({
  bot,
  quoteSource,
  children
}: {
  bot: Bot
  /** The list's quote source (botItemActivityQuoteSource); its chips find the quoted text there. */
  quoteSource: string
  children: ReactNode
}): React.JSX.Element {
  const quoteJump = useCallback<NativeChatQuoteJump>(
    ({ messageId, place }, text) => {
      // The list that carries this source; a quote from elsewhere jumps as chat's does.
      const source =
        messageId === quoteSource
          ? [...document.querySelectorAll<HTMLElement>('[data-native-chat-quote-source]')].find(
              (node) => node.dataset.nativeChatQuoteSource === quoteSource
            )
          : undefined
      if (!source) {
        return false
      }
      showQuotedText(source, text, place)
      return true
    },
    [quoteSource]
  )
  const mentionHost = mentionHostOf(bot)
  return (
    <NativeChatQuoteJumpContext.Provider value={quoteJump}>
      <NativeChatAgentMentionHostContext.Provider value={mentionHost}>
        {children}
      </NativeChatAgentMentionHostContext.Provider>
    </NativeChatQuoteJumpContext.Provider>
  )
}
