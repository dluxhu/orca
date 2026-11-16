import { useState, type ReactNode } from 'react'
import { Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

type HastNode = { type: string; value?: string; children?: HastNode[] }

function hastText(node: HastNode | undefined): string {
  return node?.type === 'text' ? (node.value ?? '') : (node?.children ?? []).map(hastText).join('')
}

/** A sent quote: a chip that shows the quoted text when the user opens it. */
export function NativeChatSentQuote({
  node,
  children
}: {
  node?: HastNode
  children?: ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const text = hastText(node).trim().replace(/\s+/g, ' ')
  return (
    <div className="my-1 flex max-w-full flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="max-w-full"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-native-chat-sent-quote=""
      >
        <Quote aria-hidden="true" />
        <span className="sr-only">{t('components.native-chat.quoteChip', 'Quote')}: </span>
        <span className="truncate">{text}</span>
      </Button>
      {open ? (
        <blockquote className="my-0 border-l-2 border-border/70 pl-3 text-muted-foreground">
          {children}
        </blockquote>
      ) : null}
    </div>
  )
}
