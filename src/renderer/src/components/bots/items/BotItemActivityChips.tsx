// What the chips in an item's Activity need: the quote chip's jump back into the Activity, and the
// host a mentioned chat or terminal opens on.
import { useCallback, useMemo, type ReactNode, type RefObject } from 'react'
import type { Bot } from '../../../../../shared/bot-types'
import {
  NativeChatQuoteJumpContext,
  type NativeChatQuoteJump
} from '../../native-chat/selection-quotes/use-native-chat-quote-jump'
import { NativeChatAgentMentionHostContext } from '../../native-chat/markdown/native-chat-agent-mentions'
import { showQuotedText } from '../../native-chat/selection-quotes/native-chat-quote-highlight'
import { botHostTarget } from '@/lib/bot-hosts'
import { botItemCommentDraftScope } from './bot-item-comment-draft'

/** The Activity's quote source: the list carries it, so a quote may span entries. */
export function botItemActivityQuoteSource(bot: Bot, itemUid: string): string {
  return botItemCommentDraftScope(bot, itemUid)
}

export function BotItemActivityChips({
  bot,
  itemUid,
  list,
  children
}: {
  bot: Bot
  itemUid: string
  list: RefObject<HTMLElement | null>
  children: ReactNode
}): React.JSX.Element {
  // The chip finds the quoted text again in the list.
  const quoteSource = botItemActivityQuoteSource(bot, itemUid)
  const quoteJump = useCallback<NativeChatQuoteJump>(
    ({ messageId, place }, text) => {
      const source = list.current
      if (!source || messageId !== quoteSource) {
        return false
      }
      showQuotedText(source, text, place)
      return true
    },
    [list, quoteSource]
  )
  // Mentioned chats and terminals open on the bot's host; an SSH-hosted bot has none here.
  const { hostId } = bot
  const mentionHost = useMemo(() => {
    try {
      return botHostTarget(hostId)
    } catch {
      return null
    }
  }, [hostId])
  return (
    <NativeChatQuoteJumpContext.Provider value={quoteJump}>
      <NativeChatAgentMentionHostContext.Provider value={mentionHost}>
        {children}
      </NativeChatAgentMentionHostContext.Provider>
    </NativeChatQuoteJumpContext.Provider>
  )
}
