import {
  setWorktreeNavActivator,
  setWorktreeNavViewActivator
} from '@/store/slices/ui/workspace-navigation-history'
import type { WorktreeNavHistoryViewEntry } from '@/store/slices/ui/workspace-navigation-history'
import type { WorktreeNavHistoryChatQuoteEntry } from '@/store/slices/ui/workspace-navigation-history-chat-place'
import { beginLinkOpenRequest } from '@/lib/links/link-open-request'
import { showNativeChatQuotePlace } from '@/components/native-chat/selection-quotes/native-chat-quote-history'

type ActivateFn = (worktreeId: string, opts: { navigationIntent: 'user-open' }) => unknown
type ViewActivateFn = (
  entry: Exclude<WorktreeNavHistoryViewEntry, WorktreeNavHistoryChatQuoteEntry>
) => void

export function registerWorktreeActivation(
  activate: ActivateFn,
  activateView: ViewActivateFn
): void {
  // Why: back/forward is the user reopening a workspace they chose, like a sidebar click.
  // Each Back or Forward step is a link open: it stops the pending steps of every earlier quote jump.
  setWorktreeNavActivator((worktreeId) => {
    beginLinkOpenRequest()
    return activate(worktreeId, { navigationIntent: 'user-open' })
  })
  setWorktreeNavViewActivator((entry) => {
    beginLinkOpenRequest()
    if (typeof entry === 'object' && entry.kind === 'native-chat-quote') {
      if (activate(entry.worktreeId, { navigationIntent: 'user-open' }) === false) {
        return false
      }
      showNativeChatQuotePlace(entry)
      return true
    }
    activateView(entry)
    return true
  })
}
