import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type Editor,
  type NodeViewProps
} from '@tiptap/react'
import { MessageSquare, SquareTerminal, Users } from 'lucide-react'
import { NativeChatPromptPill } from './NativeChatPromptPill'
import {
  agentReferenceToken,
  isAgentReferenceKind,
  type AgentReferenceKind,
  type OrchestrationAgentReference
} from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { nativeChatMentionKindLabel } from '../pickers/native-chat-mentions'
import { closeHistory } from '@tiptap/pm/history'
import { promptTextPosition } from './native-chat-prompt-document'

/** A chat or terminal chip says its kind to a screen reader; an orchestration chip has none. */
export function AgentReferencePillContent({
  label,
  kind,
  selected
}: {
  label: string
  kind: AgentReferenceKind | null
  selected: boolean
}): React.JSX.Element {
  const icon = kind === 'chat' ? MessageSquare : kind ? SquareTerminal : Users
  return (
    <>
      {kind ? <span className="sr-only">{`${nativeChatMentionKindLabel(kind)} `}</span> : null}
      <NativeChatPromptPill icon={icon} label={label} selected={selected} />
    </>
  )
}

function AgentReferencePill({ node, selected }: NodeViewProps): React.JSX.Element {
  const { kind } = node.attrs
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
    kind: { default: null }
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
  const nextNode = editor.state.selection.$to.nodeAfter
  const hasRightSeparator = nextNode?.isText
    ? /^\s/u.test(nextNode.text ?? '')
    : nextNode?.type.name === 'hardBreak'
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.insertContent(
    references.flatMap((attrs, index) => [
      { type: NativeChatAgentReference.name, attrs },
      ...(index < references.length - 1 || !hasRightSeparator ? [{ type: 'text', text: ' ' }] : [])
    ])
  )
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
