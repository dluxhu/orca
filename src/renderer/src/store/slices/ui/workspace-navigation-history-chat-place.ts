import type { AppState } from '../../types'
import type { WorktreeNavHistoryEntry } from './workspace-navigation-history'

/** A place in an agent chat: a sent quote chip, or the source that the chip jumps to. */
export type WorktreeNavHistoryChatQuoteEntry = {
  kind: 'native-chat-quote'
  worktreeId: string
  tabId: string
  /** The message that holds the chip. */
  messageId: string
  /** The chip's index among the quote chips of its message. */
  chip: number
  at: 'chip' | 'source'
}

export function isChatPlace(
  entry: WorktreeNavHistoryEntry | undefined
): entry is WorktreeNavHistoryChatQuoteEntry {
  return typeof entry === 'object' && entry.kind === 'native-chat-quote'
}

export function hasChatTab(
  place: WorktreeNavHistoryChatQuoteEntry,
  state: Pick<AppState, 'unifiedTabsByWorktree'>
): boolean {
  return (
    state.unifiedTabsByWorktree[place.worktreeId]?.some((tab) => tab.id === place.tabId) ?? false
  )
}

/** The entry whose view an entry shows now. A chat place whose tab is closed shows only its workspace. */
export function shownEntry(
  entry: WorktreeNavHistoryEntry,
  state: Pick<AppState, 'unifiedTabsByWorktree'>
): WorktreeNavHistoryEntry {
  return isChatPlace(entry) && !hasChatTab(entry, state) ? entry.worktreeId : entry
}
