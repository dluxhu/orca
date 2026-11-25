import type {
  WorktreeNavHistoryEntry,
  WorktreeNavHistorySimpleViewEntry
} from './workspace-navigation-history'
import { getTaskSourceCacheScope } from '../../../../../shared/work-items/task-source-context'
import { automationsPageLocationKey } from './automations-page-location'

const SIMPLE_VIEW_ENTRIES: readonly WorktreeNavHistorySimpleViewEntry[] = [
  'tasks',
  'automations',
  'artifacts',
  'skills'
]

export function isSimpleViewEntry(
  entry: WorktreeNavHistoryEntry
): entry is WorktreeNavHistorySimpleViewEntry {
  return SIMPLE_VIEW_ENTRIES.some((view) => view === entry)
}

/** The identity of an entry: two entries with one key show the same place. */
export function getHistoryEntryKey(entry: WorktreeNavHistoryEntry): string {
  if (typeof entry === 'string') {
    return isSimpleViewEntry(entry) ? `view:${entry}` : `worktree:${entry}`
  }
  if (entry.kind === 'native-chat-quote') {
    return `chat:${entry.tabId}:${entry.messageId}:${entry.chip}:${entry.at}`
  }
  if (entry.kind === 'automations-page') {
    return `view:automations-page:${automationsPageLocationKey(entry.location)}`
  }
  if (entry.source === 'github') {
    const sourceScope =
      entry.sourceContext?.provider === 'github'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:github:${sourceScope}:${entry.workItem.repoId}:${entry.workItem.type}:${entry.workItem.number}:${entry.initialTab ?? 'conversation'}`
  }
  if (entry.source === 'gitlab') {
    const sourceScope =
      entry.sourceContext?.provider === 'gitlab'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:gitlab:${sourceScope}:${entry.workItem.repoId}:${entry.workItem.type}:${entry.workItem.number}`
  }
  if (entry.source === 'jira') {
    const sourceScope =
      entry.sourceContext?.provider === 'jira'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:jira:${sourceScope}:${entry.issue.siteId ?? 'selected'}:${entry.issue.key}`
  }
  const sourceScope =
    entry.sourceContext?.provider === 'linear'
      ? getTaskSourceCacheScope(entry.sourceContext)
      : 'legacy'
  return `view:task-detail:linear:${sourceScope}:${entry.issue.workspaceId ?? 'selected'}:${entry.issue.id}`
}
