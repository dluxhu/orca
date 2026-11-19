import { MessageSquare, SquareTerminal } from 'lucide-react'
import { FilenameFirstPath } from '@/components/file-path-cursor-tooltip'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { nativeChatMentionKindLabel, type NativeChatMentionItem } from './native-chat-mentions'

const ICON_CLASS = 'mt-0.5 size-3.5 shrink-0 text-muted-foreground'

/** One `@` menu row: a workspace file, or another chat or terminal with its kind, host and workspace. */
export function NativeChatMentionLabel({
  item
}: {
  item: NativeChatMentionItem
}): React.JSX.Element {
  useUiLanguageRevision()
  if (typeof item === 'string') {
    return (
      <>
        <FileTypeIcon filePath={item} className={ICON_CLASS} />
        <FilenameFirstPath path={item} />
      </>
    )
  }
  const Icon = item.kind === 'chat' ? MessageSquare : SquareTerminal
  const host =
    item.environment ?? translate('components.native-chat.composer.mentionThisHost', 'This host')
  // The spaces between the spans keep the row's accessible name "<name> <kind> <host> <workspace>".
  return (
    <>
      <Icon aria-hidden="true" className={ICON_CLASS} />
      <span className="min-w-0 truncate">{item.label}</span>{' '}
      <span className="ml-auto shrink-0 truncate pl-2 text-muted-foreground">
        {nativeChatMentionKindLabel(item.kind)} <span aria-hidden="true">· </span>
        {host}
        {item.detail ? (
          <>
            {' '}
            <span aria-hidden="true">· </span>
            {item.detail}
          </>
        ) : null}
      </span>
    </>
  )
}
