import {
  setWorktreeNavActivator,
  setWorktreeNavViewActivator
} from '@/store/slices/ui/workspace-navigation-history'
import type {
  WorktreeNavHistoryChatQuoteEntry,
  WorktreeNavHistoryViewEntry
} from '@/store/slices/ui/workspace-navigation-history'
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
  setWorktreeNavActivator((worktreeId) => activate(worktreeId, { navigationIntent: 'user-open' }))
  setWorktreeNavViewActivator((entry) => {
    if (typeof entry === 'object' && entry.kind === 'native-chat-quote') {
      activate(entry.worktreeId, { navigationIntent: 'user-open' })
      showNativeChatQuotePlace(entry)
      return
    }
    activateView(entry)
  })
}
