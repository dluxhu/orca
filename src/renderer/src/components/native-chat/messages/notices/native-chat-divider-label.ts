import type { Translate } from '@/i18n/use-translate'
import {
  NATIVE_CHAT_NOTICE_COPY,
  type NativeChatNoticeLook
} from '../../../../../../shared/native-chat/transcript/notices/native-chat-notice'

/** The translated label of a divider notice. */
export function nativeChatDividerLabel(
  t: Translate,
  label: Extract<NativeChatNoticeLook, { kind: 'divider' }>['label']
): string {
  if (label === 'contextCleared') {
    return t(
      'components.native-chat.notices.contextCleared',
      NATIVE_CHAT_NOTICE_COPY.contextCleared
    )
  }
  if (label === 'compactionAutomatic') {
    return t(
      'components.native-chat.notices.compactionAutomatic',
      NATIVE_CHAT_NOTICE_COPY.compactionAutomatic
    )
  }
  return t('components.native-chat.notices.compaction', NATIVE_CHAT_NOTICE_COPY.compaction)
}
