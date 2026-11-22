import type { Parent, PhrasingContent, Root, RootContent } from 'mdast'
import type { CommentMarkdownExtension } from '@/components/comment-markdown/CommentMarkdown'
import { AgentReferencePillContent } from '../composer/editor/native-chat-agent-reference'
import type { SentAgentMention } from '../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { useTranslate } from '@/i18n/use-translate'
import { useNativeChatVisualOwner } from '../media/visuals/native-chat-visual-owner'
import { openSentAgentMention } from './open-sent-agent-mention'

// The hast property that carries a mention label through sanitize to the chip.
const MENTION_PROPERTY = 'dataNativeChatAgentMention'

/** Splits each `@label` of a sent mention out of the text into a chip node. Code keeps its text. */
function remarkNativeChatAgentMentions(mentions: readonly SentAgentMention[]) {
  // Longest first: a label that starts a longer label does not take its place.
  const tokens = [...new Set(mentions.map(({ label }) => `@${label}`))].sort(
    (a, b) => b.length - a.length
  )
  const split = (value: string): PhrasingContent[] => {
    const parts: PhrasingContent[] = []
    let rest = value
    for (;;) {
      let at = -1
      let token = ''
      for (const candidate of tokens) {
        const index = rest.indexOf(candidate)
        if (index !== -1 && (at === -1 || index < at)) {
          at = index
          token = candidate
        }
      }
      if (at === -1) {
        break
      }
      if (at > 0) {
        parts.push({ type: 'text', value: rest.slice(0, at) })
      }
      parts.push({
        type: 'text',
        value: token,
        data: { hName: 'span', hProperties: { [MENTION_PROPERTY]: token.slice(1) } }
      })
      rest = rest.slice(at + token.length)
    }
    return rest ? [...parts, { type: 'text', value: rest }] : parts
  }
  const walk = (node: Parent): void => {
    node.children = (node.children as RootContent[]).flatMap((child): RootContent[] => {
      // A text node another extension made a chip keeps its chip.
      if (child.type === 'text' && !child.data?.hName) {
        return split(child.value)
      }
      if ('children' in child) {
        walk(child)
      }
      return [child]
    }) as Parent['children']
  }
  return (tree: Root) => walk(tree)
}

/** The typed text with each mention as plain Markdown text: the note's `\[` escape starts math.
 *  The body frames a label as the note does; a character reference keeps each sign literal. */
export function plainNativeChatAgentMentions(
  body: string,
  mentions: readonly SentAgentMention[]
): string {
  return [...mentions]
    .sort((a, b) => b.label.length - a.label.length)
    .reduce(
      (text, { label }) =>
        text.replaceAll(
          `@${label.replace(/[\\"[\]]/g, '\\$&')}`,
          `@${label.replace(/[^\p{L}\p{N} ]/gu, (sign) => `&#${sign.codePointAt(0)};`)}`
        ),
      body
    )
}

/** A sent mention's chip. In a chat's transcript, a chat or terminal chip is a button that opens it. */
function SentAgentMentionChip({ mention }: { mention: SentAgentMention }): React.JSX.Element {
  const t = useTranslate()
  const owner = useNativeChatVisualOwner()
  const pill = (
    <AgentReferencePillContent label={mention.label} kind={mention.kind} selected={false} />
  )
  // A crew or Dispatch mention names work, not a session to open.
  if (!owner || mention.kind === null) {
    return pill
  }
  return (
    <button
      type="button"
      className="rounded-sm align-baseline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('components.native-chat.agentMessage.open', 'Open {{name}}', {
        name: mention.label
      })}
      onClick={() => void openSentAgentMention(mention, owner.target)}
    >
      {pill}
    </button>
  )
}

/** Shows the agents a sent message mentions as the chips the composer showed. */
export function withNativeChatAgentMentions(
  extension: CommentMarkdownExtension,
  mentions: readonly SentAgentMention[] | undefined
): CommentMarkdownExtension {
  if (!mentions?.length) {
    return extension
  }
  // Another extension's span renderer still draws every other span.
  const Span = extension.components.span
  return {
    ...extension,
    remarkPlugins: [...extension.remarkPlugins, [remarkNativeChatAgentMentions, mentions]],
    sanitizeAttributes: {
      ...extension.sanitizeAttributes,
      span: [...(extension.sanitizeAttributes.span ?? []), MENTION_PROPERTY]
    },
    components: {
      ...extension.components,
      span: (props) => {
        const label = (props as Record<string, unknown>)['data-native-chat-agent-mention']
        // Raw HTML can carry the property too; only a mention of this message is a chip.
        const mention = mentions.find((candidate) => candidate.label === label)
        if (mention) {
          return <SentAgentMentionChip mention={mention} />
        }
        const { node: _node, ...rest } = props
        return typeof Span === 'function' ? <Span {...props} /> : <span {...rest} />
      }
    }
  }
}
