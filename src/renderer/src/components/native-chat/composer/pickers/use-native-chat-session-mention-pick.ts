import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { nativeChatMentionSessionOf, type NativeChatMentionSession } from './native-chat-mentions'

/** The picker calls that put another chat or terminal in. Without them, `@` lists none. */
export type NativeChatSessionMentionPicker = {
  completeSessionMention?: (session: NativeChatMentionSession) => void
  /** Moves the highlighted row; late rows keep it with this. */
  navigateSuggestion?: Dispatch<SetStateAction<number>>
}

/** Picks a listed chat or terminal as a session chip, and any other value with `choose`. */
export function useNativeChatSessionMentionPick(
  sessions: readonly NativeChatMentionSession[] | undefined,
  { completeSessionMention }: NativeChatSessionMentionPicker,
  choose: (value: string) => void
): (value: string) => void {
  return useCallback(
    (value: string) => {
      const session = nativeChatMentionSessionOf(sessions, value)
      if (session) {
        completeSessionMention?.(session)
        return
      }
      choose(value)
    },
    [sessions, completeSessionMention, choose]
  )
}
