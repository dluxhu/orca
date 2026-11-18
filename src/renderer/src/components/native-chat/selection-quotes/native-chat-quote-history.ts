import { useAppStore } from '@/store'
import { findLinkSourceTab } from '@/lib/links/placement/link-open-intent'
import {
  appendHistoryEntry,
  type WorktreeNavHistoryChatQuoteEntry
} from '@/store/slices/ui/workspace-navigation-history'
import type { NativeChatFileLinkContext } from '../links/actions/native-chat-file-link-context'
import { nativeChatMessageReveals } from './use-native-chat-quote-jump'

const MESSAGE = '[data-native-chat-message-id]'
const CHIP = '[data-native-chat-sent-quote]'
// True while Forward clicks a chip again: that jump is in the history already.
let replaying = false

/** Adds the chip's place and its source to Back and Forward, after a jump from the chip. */
export function recordNativeChatQuoteJump(
  chip: HTMLElement,
  owner: NativeChatFileLinkContext | null
): void {
  if (replaying || !owner?.sourceTabId) {
    return
  }
  const message = chip.closest(MESSAGE)
  const messageId = message?.getAttribute('data-native-chat-message-id')
  const tab = findLinkSourceTab(
    useAppStore.getState().unifiedTabsByWorktree[owner.worktreeId] ?? [],
    owner.sourceTabId
  )
  if (!message || !messageId || !tab) {
    return
  }
  const place = {
    kind: 'native-chat-quote',
    worktreeId: owner.worktreeId,
    tabId: tab.id,
    messageId,
    chip: [...message.querySelectorAll(CHIP)].indexOf(chip)
  } as const
  useAppStore.setState((state) => {
    // The chip's place replaces the entry of its own workspace, so Back has no step that shows the same view.
    const from =
      state.worktreeNavHistory[state.worktreeNavHistoryIndex] === owner.worktreeId
        ? { ...state, worktreeNavHistoryIndex: state.worktreeNavHistoryIndex - 1 }
        : state
    return appendHistoryEntry(appendHistoryEntry(from, { ...place, at: 'chip' }), {
      ...place,
      at: 'source'
    })
  })
}

function showChip(scroller: HTMLElement, place: WorktreeNavHistoryChatQuoteEntry): void {
  const chip = scroller
    .querySelector(`[data-native-chat-message-id="${CSS.escape(place.messageId)}"]`)
    ?.querySelectorAll<HTMLElement>(CHIP)[place.chip]
  if (place.at === 'chip') {
    chip?.focus()
    return
  }
  replaying = true
  try {
    chip?.click()
  } finally {
    replaying = false
  }
}

/** Shows a chat place from Back or Forward: focuses the chip, or jumps from the chip to its source again. */
export function showNativeChatQuotePlace(place: WorktreeNavHistoryChatQuoteEntry): void {
  const state = useAppStore.getState()
  // A closed chat leaves only its workspace, which the caller opened.
  if (!state.unifiedTabsByWorktree[place.worktreeId]?.some((tab) => tab.id === place.tabId)) {
    return
  }
  state.activateTab(place.tabId, { worktreeId: place.worktreeId })
  // shortcut: a transcript that is not drawn on the next frame does not scroll; wait for its rows if a chat in another workspace needs it.
  requestAnimationFrame(() => {
    for (const reveal of nativeChatMessageReveals) {
      if (reveal(place.messageId, (scroller) => showChip(scroller, place))) {
        return
      }
    }
  })
}
