import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type Editor,
  type NodeViewProps
} from '@tiptap/react'
import { MessageSquare, SquareTerminal, Users } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { AgentTypeIcon } from '@/components/agent/icons/agent-type-icon'
import { NativeChatPromptPill } from './NativeChatPromptPill'
import {
  agentReferenceToken,
  isAgentReferenceKind,
  type AgentReferenceKind,
  type OrchestrationAgentReference
} from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { closeHistory } from '@tiptap/pm/history'
import { promptTextPosition } from './native-chat-prompt-document'

/** A chat or terminal chip says its kind to a screen reader; an orchestration chip says "Agent". */
export function AgentReferencePillContent({
  label,
  kind,
  agentType = '',
  selected
}: {
  label: string
  kind: AgentReferenceKind | null
  /** The agent's logo, where the chip was picked from a list that knows it. */
  agentType?: string
  selected: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const icon = kind === 'chat' ? MessageSquare : kind ? SquareTerminal : Users
  const spokenLabel =
    kind === 'chat'
      ? t('components.native-chat.composer.chatPillLabel', 'Chat: {{name}}', { name: label })
      : kind
        ? t('components.native-chat.composer.terminalPillLabel', 'Terminal: {{name}}', {
            name: label
          })
        : t('components.native-chat.composer.agentPillLabel', 'Agent: {{name}}', { name: label })
  return (
    <NativeChatPromptPill
      icon={icon}
      // Older drafts keep the generic icon.
      avatar={
        agentType ? <AgentTypeIcon agentType={agentType} size={12} className="size-3" /> : undefined
      }
      label={label}
      spokenLabel={spokenLabel}
      selected={selected}
    />
  )
}

function AgentReferencePill({ node, selected }: NodeViewProps): React.JSX.Element {
  const { kind } = node.attrs
  const agentType = String(node.attrs.agentType ?? '')
  return (
    <NodeViewWrapper
      as="span"
      className="inline"
      contentEditable={false}
      data-native-chat-agent-reference={node.attrs.address}
    >
      <AgentReferencePillContent
        label={String(node.attrs.label)}
        kind={isAgentReferenceKind(kind) ? kind : null}
        agentType={agentType}
        selected={selected}
      />
    </NodeViewWrapper>
  )
}

export const NativeChatAgentReference = Node.create({
  name: 'nativeChatAgentReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    label: { default: '' },
    address: { default: '' },
    hostKey: { default: '' },
    kind: { default: null },
    agentType: { default: '' }
  }),
  addNodeView: () => ReactNodeViewRenderer(AgentReferencePill),
  renderText: ({ node }) =>
    agentReferenceToken({
      label: String(node.attrs.label),
      address: String(node.attrs.address),
      hostKey: String(node.attrs.hostKey)
    }),
  renderHTML: ({ node }) => [
    'span',
    { 'data-native-chat-agent-reference': node.attrs.address },
    `@${node.attrs.label}`
  ]
})

/**
 * A draft holds each agent once: references already in it, or repeated in the list, are skipped.
 * `replace` is a text range (an `@` token) that the chips take the place of, only when one is inserted.
 */
export function insertAgentReferences(
  editor: Editor,
  candidates: OrchestrationAgentReference[],
  replace?: { from: number; to: number }
): boolean {
  if (!editor.isEditable) {
    return false
  }
  const present = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === NativeChatAgentReference.name) {
      present.add(`${node.attrs.hostKey}\0${node.attrs.address}`)
    }
  })
  const references = candidates.filter(({ hostKey, address }) => {
    const key = `${hostKey}\0${address}`
    return !present.has(key) && Boolean(present.add(key))
  })
  if (references.length === 0) {
    return false
  }
  if (replace) {
    const { doc } = editor.state
    editor.commands.setTextSelection({
      from: promptTextPosition(doc, replace.from),
      to: promptTextPosition(doc, replace.to)
    })
  }
  const { $to } = editor.state.selection
  const nextNode = $to.nodeAfter
  const endsNonFinalLine =
    !nextNode && $to.depth > 0 && $to.after(1) < editor.state.doc.content.size
  const hasRightSeparator = nextNode?.isText ? /^\s/u.test(nextNode.text ?? '') : endsNonFinalLine
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.insertContent(
    references.flatMap((attrs, index) => [
      {
        type: NativeChatAgentReference.name,
        attrs: { ...attrs, agentType: attrs.agentType ?? '' }
      },
      ...(index < references.length - 1 || !hasRightSeparator ? [{ type: 'text', text: ' ' }] : [])
    ])
  )
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
