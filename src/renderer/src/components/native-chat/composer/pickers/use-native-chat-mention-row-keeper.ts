import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'

/** Rows that arrive with no edit (late sessions, late files) keep the highlighted row; an edit resets it. */
export function useNativeChatMentionRowKeeper(
  rows: readonly string[] | null,
  editKey: string,
  setActiveSuggestion: Dispatch<SetStateAction<number>> | undefined
): void {
  // A session row's string starts with \0, so rows join with a separator no row holds.
  const rowKey = rows ? rows.join('\u0001') : null
  const shownRef = useRef<{ editKey: string; rowIds: string[] } | null>(null)
  // Why layout: the highlight moves before the menu paints, so Enter never picks a row that moved in.
  useLayoutEffect(() => {
    const prev = shownRef.current
    if (rowKey === null) {
      shownRef.current = null
      return
    }
    const rowIds = rowKey === '' ? [] : rowKey.split('\u0001')
    shownRef.current = { editKey, rowIds }
    if (!prev || prev.editKey !== editKey || !setActiveSuggestion) {
      return
    }
    setActiveSuggestion((current) => {
      const kept = rowIds.indexOf(prev.rowIds[current] ?? '')
      return kept === -1 ? current : kept
    })
  }, [editKey, rowKey, setActiveSuggestion])
}
