import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Quote } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { NativeChatPromptPill } from './NativeChatPromptPill'
import { quotedText } from '../../selection-quotes/native-chat-quote-selection'

export function NativeChatQuotePill({ node, selected }: NodeViewProps): React.JSX.Element {
  const t = useTranslate()
  const text = quotedText(String(node.attrs.token))
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <NativeChatPromptPill
        icon={Quote}
        label={text.replace(/\s+/g, ' ')}
        selected={selected}
        title={text}
        aria-label={`${t('components.native-chat.quoteChip', 'Quote')}: ${text}`}
        data-native-chat-quote=""
      />
    </NodeViewWrapper>
  )
}
