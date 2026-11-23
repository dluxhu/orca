import { historyEntryWorkspaceId } from '@/store/slices/ui/workspace-navigation-history'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'

export function reopenClosedWorkspaceTab(activeWorktreeId: string | null): void {
  const state = useAppStore.getState()
  // Closing the last tab lands on welcome without discarding the workspace navigation entry.
  const previous = state.worktreeNavHistory[state.worktreeNavHistoryIndex]
  const worktreeId =
    activeWorktreeId ?? (previous === undefined ? null : historyEntryWorkspaceId(previous))
  if (!worktreeId || !state.reopenClosedTab(worktreeId)) {
    return
  }
  if (!activeWorktreeId) {
    // Same activation as history replay: entries may be folder workspace keys, and this is a user open.
    activateAndRevealWorkspace(worktreeId, { navigationIntent: 'user-open' })
  }
}
