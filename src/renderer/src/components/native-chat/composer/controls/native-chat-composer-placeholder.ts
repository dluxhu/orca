import type { NativeChatAfterStopSend } from '../submit/native-chat-composer-target'
import { translate } from '../../../../i18n/i18n'
import { useTranslate, type Translate } from '../../../../i18n/use-translate'
import { useAppStore } from '../../../../store'
import { nativeChatSendsWithModEnter } from '../../../../../../shared/native-chat/native-chat-appearance-settings'
import { getScreenSubmitShortcutLabel } from '../../../../lib/keyboard/screen-submit-shortcut'
import {
  NATIVE_CHAT_TURN_STATUS_COPY,
  NATIVE_CHAT_COMPOSER_PLACEHOLDER
} from '../../../../../../shared/native-chat/transcript/turns/native-chat-turn-status'

export function nativeChatComposerPlaceholder(
  hasPty: boolean,
  canSend: boolean,
  afterStop?: NativeChatAfterStopSend,
  t: Translate = translate,
  sendWithModEnter = false
): string {
  if (!hasPty) {
    return t(
      'components.native-chat.composer.noPty',
      'No live terminal — toggle back to reconnect.'
    )
  }
  if (!canSend) {
    return t('components.native-chat.composer.locked', 'Input is held by another device.')
  }
  if (afterStop === 'queue') {
    return t(
      'components.native-chat.status.queueAfterStop',
      NATIVE_CHAT_TURN_STATUS_COPY.queueAfterStop
    )
  }
  if (afterStop === 'send') {
    return t(
      'components.native-chat.status.sendAfterStop',
      NATIVE_CHAT_TURN_STATUS_COPY.sendAfterStop
    )
  }
  if (sendWithModEnter) {
    return t(
      'components.native-chat.composer.placeholderSendWithModEnter',
      'Ask anything, @ to mention files, / for commands, {{shortcut}} to send',
      { shortcut: getScreenSubmitShortcutLabel() }
    )
  }
  return t('components.native-chat.composer.placeholder', NATIVE_CHAT_COMPOSER_PLACEHOLDER)
}

/** The composer placeholder; while Cmd/Ctrl+Enter sends, it names that key. */
export function useNativeChatComposerPlaceholder({
  hasPty,
  canSend,
  afterStop,
  editing,
  goal,
  hint,
  launchPrompt
}: {
  hasPty: boolean
  canSend: boolean
  afterStop?: NativeChatAfterStopSend
  editing: boolean
  goal: boolean
  /** Shown in place of the default text: why the composer is disabled, a suggested prompt, or a room's hint. */
  hint?: string
  /** A launch prompt keeps Enter as its send. */
  launchPrompt?: string
}): string {
  const t = useTranslate()
  const sendWithModEnter = useAppStore((state) => nativeChatSendsWithModEnter(state.settings))
  const shortcut = { shortcut: getScreenSubmitShortcutLabel() }
  if (launchPrompt !== undefined) {
    return launchPrompt
  }
  if (editing) {
    return sendWithModEnter
      ? t(
          'components.native-chat.queuedMessages.editMessageWithModEnter',
          'Edit message, {{shortcut}} to save',
          shortcut
        )
      : t('components.native-chat.queuedMessages.editMessage', 'Edit message')
  }
  if (goal) {
    return sendWithModEnter
      ? t(
          'components.native-chat.goal.placeholderWithModEnter',
          'Describe your goal, define measurable outcomes for best results, {{shortcut}} to send',
          shortcut
        )
      : t(
          'components.native-chat.goal.placeholder',
          'Describe your goal, define measurable outcomes for best results'
        )
  }
  return hint ?? nativeChatComposerPlaceholder(hasPty, canSend, afterStop, t, sendWithModEnter)
}
