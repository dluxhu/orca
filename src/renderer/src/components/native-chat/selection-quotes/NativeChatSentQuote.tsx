import { useContext } from 'react'
import { Quote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { openDetectedFilePath } from '@/components/terminal-pane/links/files/terminal-file-open-routing'
import type { NativeChatFileLinkContext } from '../links/actions/native-chat-file-link-context'
import { resolveNativeChatFileLink } from '../links/actions/native-chat-file-link'
import { nativeChatFileOpenDeps } from '../links/actions/native-chat-link-target-actions'
import { NativeChatMarkdownImageOwnerContext } from '../media/images/native-chat-markdown-image-owner'
import { jumpToQuoteSource, type QuotedFileLocation } from './native-chat-quote-sources'
import { NativeChatQuoteJumpContext } from './use-native-chat-quote-jump'

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] }

function hastText(node: HastNode | undefined): string {
  return node?.type === 'text' ? (node.value ?? '') : (node?.children ?? []).map(hastText).join('')
}

function openQuotedFile(
  location: QuotedFileLocation,
  context: NativeChatFileLinkContext | null
): boolean {
  const target = resolveNativeChatFileLink(`${location.pathText}:${location.line}`, context)
  if (!context || !target) {
    return false
  }
  openDetectedFilePath(target.absolutePath, target.line ?? location.line, 1, {
    ...nativeChatFileOpenDeps(target, context),
    // The reveal stops at the line end, so this highlights the first quoted line.
    revealLength: Number.MAX_SAFE_INTEGER
  })
  return true
}

/** A sent quote: a chip that goes back to where the quote came from. */
export function NativeChatSentQuote({ node }: { node?: HastNode }): React.JSX.Element {
  const t = useTranslate()
  const jumpToMessage = useContext(NativeChatQuoteJumpContext)
  const fileLinkContext = useContext(NativeChatMarkdownImageOwnerContext)?.fileLinkContext ?? null
  const text = hastText(node).trim()
  const firstLine = hastText(node?.children?.find((child) => child.tagName === 'p'))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="my-1 max-w-full"
          onClick={() =>
            jumpToQuoteSource(text, firstLine, {
              jumpToMessage,
              openFile: (location) => openQuotedFile(location, fileLinkContext),
              notifyMissing: () =>
                toast(
                  t(
                    'components.native-chat.quoteSourceMissing',
                    'The source of this quote is not available.'
                  )
                )
            })
          }
          data-native-chat-sent-quote=""
        >
          <Quote aria-hidden="true" />
          <span className="sr-only">{t('components.native-chat.quoteChip', 'Quote')}: </span>
          <span className="truncate">{text.replace(/\s+/g, ' ')}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap">{text}</TooltipContent>
    </Tooltip>
  )
}
