// An item's description or comment, drawn by chat's own Markdown so it reads and links as chat does.
import { memo } from 'react'
import { NativeChatMarkdown } from '../../native-chat/markdown/NativeChatMarkdown'
import { NativeChatDeferredCodeBlock } from '../../native-chat/markdown/code/NativeChatCodeBlock'
import type { SentAgentMention } from '../../../../../shared/orchestration/mailbox/orchestration-agent-reference'

// Chat spacing, tightened for item cards: no outer block margins, smaller gaps around code and headings.
const ITEM_DENSITY =
  'text-[13px] leading-[19px] text-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_[data-native-chat-code-block]]:my-2 [&_:is(h1,h2,h3,h4,h5,h6)]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1'

// Memoized: the comment box and live item updates re-render the pane, never an unchanged text.
export const BotItemMarkdown = memo(function BotItemMarkdown({
  text,
  quoteChips = false,
  agentMentions
}: {
  text: string
  /** The owner's comment: its quotes show as chat's quote chips, as in a sent chat message. */
  quoteChips?: boolean
  /** The chats and terminals the comment mentions, shown as chat's chips. Keep it stable. */
  agentMentions?: readonly SentAgentMention[]
}): React.JSX.Element {
  return (
    <NativeChatMarkdown
      content={text}
      variant="document"
      quoteChips={quoteChips}
      agentMentions={agentMentions}
      renderCodeBlock={NativeChatDeferredCodeBlock}
      linkifyFilePaths
      className={ITEM_DENSITY}
    />
  )
})
