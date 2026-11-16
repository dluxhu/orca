import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { NativeChatMentionItem } from './native-chat-mentions'

const rowId = (item: NativeChatMentionItem): string =>
  typeof item === 'string' ? `file:${item}` : `${item.kind}:${item.address}`

/** Rows that arrive with no edit (late sessions, late files) keep the highlighted row; an edit resets it. */
export function useNativeChatMentionRowKeeper(
  items: readonly NativeChatMentionItem[] | null,
  editKey: string,
  setActiveSuggestion: Dispatch<SetStateAction<number>>
): void {
  const rowKey = items ? items.map(rowId).join('\0') : null
  const shownRef = useRef<{ editKey: string; rowIds: string[] } | null>(null)
  // Why layout: the highlight moves before the menu paints, so Enter never picks a row that moved in.
  useLayoutEffect(() => {
    const prev = shownRef.current
    if (rowKey === null) {
      shownRef.current = null
      return
    }
    const rowIds = rowKey === '' ? [] : rowKey.split('\0')
    shownRef.current = { editKey, rowIds }
    if (!prev || prev.editKey !== editKey) {
      return
    }
    setActiveSuggestion((current) => {
      const kept = rowIds.indexOf(prev.rowIds[current] ?? '')
      return kept === -1 ? current : kept
    })
  }, [editKey, rowKey, setActiveSuggestion])
}
