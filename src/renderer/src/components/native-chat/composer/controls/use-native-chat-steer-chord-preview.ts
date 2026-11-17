import { useEffect, useState, type RefObject } from 'react'
import type { NativeChatFollowUpBehavior } from '../../../../../../shared/native-chat/input/native-chat-follow-up-behavior'
import { createNativeChatSteerChordPreviewHook } from '../../../../../../shared/native-chat/input/use-native-chat-steer-chord-preview'

import type { NativeChatComposerSendIntent } from '../submit/native-chat-composer-send-intent'
import { isMacPlatform } from '../../pane/routing/native-chat-shortcut'
import { useAppStore } from '@/store'
import { nativeChatSendsWithModEnter } from '../../../../../../shared/native-chat/native-chat-appearance-settings'

const useSteerChordPreview = createNativeChatSteerChordPreviewHook({ useEffect, useState })

/** Desktop's chord: Cmd+Enter on a Mac, Ctrl+Enter elsewhere. */
export function useNativeChatSteerChordPreview(
  root: RefObject<HTMLElement | null>,
  sendState: {
    alternateSend?: NativeChatFollowUpBehavior
    hasDraft: boolean
    chordSteersHead: boolean
  },
  steerHead: (() => boolean) | undefined,
  send: (intent?: NativeChatComposerSendIntent) => void,
  pickerOpen: boolean
) {
  // Cmd/Ctrl+Enter sends plainly then, so a held Cmd/Ctrl has no other send to preview.
  const sendWithModEnter = useAppStore((state) => nativeChatSendsWithModEnter(state.settings))
  return useSteerChordPreview(
    root,
    sendWithModEnter ? { hasDraft: sendState.hasDraft, chordSteersHead: false } : sendState,
    steerHead,
    () => send({ alternate: true }),
    pickerOpen,
    isMacPlatform() ? 'Meta' : 'Control'
  )
}
