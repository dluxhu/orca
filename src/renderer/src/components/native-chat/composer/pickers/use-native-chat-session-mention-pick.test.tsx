import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  nativeChatMentionSessionValue,
  type NativeChatMentionSession
} from './native-chat-mentions'
import { useNativeChatSessionMentionPick } from './use-native-chat-session-mention-pick'

const session: NativeChatMentionSession = {
  kind: 'chat',
  label: 'Review',
  address: 'orca_session_id:s1',
  hostKey: 'local',
  detail: 'repo'
}

describe('useNativeChatSessionMentionPick', () => {
  it('puts a listed session in as a chip, and gives any other value to choose', () => {
    const completeSessionMention = vi.fn()
    const choose = vi.fn()
    const { result } = renderHook(() =>
      useNativeChatSessionMentionPick([session], { completeSessionMention }, choose)
    )

    result.current(nativeChatMentionSessionValue(session))
    result.current('src/a.ts')

    expect(completeSessionMention).toHaveBeenCalledExactlyOnceWith(session)
    expect(choose).toHaveBeenCalledExactlyOnceWith('src/a.ts')
  })
})
