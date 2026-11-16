import type { JSONContent } from '@tiptap/react'
import type { AgentJournalSkillRef } from '../../../../../../shared/agent-session/journal/agent-session-journal-types'
import { agentReferenceToken } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import {
  imageReferenceToken,
  splitImageReferences
} from '../../../../../../shared/native-chat/native-chat-image-reference'
import { NATIVE_CHAT_PASTED_TEXT_TOKEN } from '../../paste/native-chat-pasted-text-reference'

export const IMAGE_REFERENCE_NODE = 'nativeChatImageReference'
export const FILE_REFERENCE_NODE = 'nativeChatFileReference'

export function promptLeafString(
  type: string | undefined,
  attrs: Readonly<Record<string, unknown>> | undefined,
  text?: string | null
): string {
  if (type === 'nativeChatAgentReference') {
    return agentReferenceToken({
      label: String(attrs?.label),
      address: String(attrs?.address),
      hostKey: String(attrs?.hostKey)
    })
  }
  if (type === IMAGE_REFERENCE_NODE) {
    return imageReferenceToken(String(attrs?.attachmentId))
  }
  return type === 'hardBreak' ? '\n' : (text ?? String(attrs?.token ?? ''))
}

export const QUOTE_NODE = 'nativeChatQuote'
const QUOTE_LINE = /^>( |$)/

function promptLineContent(line: string): JSONContent[] {
  return splitImageReferences(line).flatMap((part) =>
    typeof part === 'string'
      ? part
          .split(NATIVE_CHAT_PASTED_TEXT_TOKEN)
          .flatMap((piece, index): JSONContent[] =>
            piece === ''
              ? []
              : index % 2 === 1
                ? [{ type: FILE_REFERENCE_NODE, attrs: { token: piece, path: '' } }]
                : [{ type: 'text', text: piece }]
          )
      : [{ type: IMAGE_REFERENCE_NODE, attrs: { attachmentId: part.attachmentId } }]
  )
}

/**
 * All text-to-document paths must reconstruct image chips and pending-paste pills.
 * Quoted lines that a blank line or the end closes become one quote chip, as "Add to chat" writes
 * them. `literal` text (a paste) keeps its quoted lines as text.
 */
export function promptTextContent(text: string, options?: { literal?: boolean }): JSONContent {
  const lines = text.split('\n')
  const content: JSONContent[] = []
  for (let index = 0; index < lines.length; index++) {
    let end = index
    while (!options?.literal && end < lines.length && QUOTE_LINE.test(lines[end])) {
      end++
    }
    if (end > index && (end === lines.length || lines[end] === '')) {
      const token = lines.slice(index, end).join('\n')
      content.push({ type: 'paragraph', content: [{ type: QUOTE_NODE, attrs: { token } }] })
      index = end - 1
    } else {
      content.push({ type: 'paragraph', content: promptLineContent(lines[index]) })
    }
  }
  return { type: 'doc', content }
}

// A line that is not a quote line and not blank: it holds the place of a line with other pills.
const KEPT_LINE = 'x'

/** A line of text and quote chips only; a line with other pills stays as it is. */
function plainLine(block: JSONContent): string | null {
  let text = ''
  for (const child of block.type === 'paragraph' ? (block.content ?? []) : [null]) {
    if (child?.type === 'text') {
      text += child.text ?? ''
    } else if (child?.type === QUOTE_NODE) {
      text += String(child.attrs?.token ?? '')
    } else {
      return null
    }
  }
  return text
}

function inQuoteRun(block: JSONContent): boolean {
  const line = plainLine(block)
  return line !== null && QUOTE_LINE.test(line)
}

function blockKey(block: JSONContent, index: number): string {
  return plainLine(block) === null
    ? `kept:${index}`
    : JSON.stringify((block.content ?? []).map((child) => [child.type, child.text, child.attrs]))
}

/**
 * The quote chips of blocks `first`..`last`, with their whole quote runs, as the parser reads
 * their text: the document then has the chips the sent text has. The text stays the same.
 * Returns null when the chips are already right.
 */
export function reparseQuoteBlocks(
  count: number,
  block: (index: number) => JSONContent,
  first: number,
  last: number
): { first: number; last: number; blocks: JSONContent[] } | null {
  // Whole quote runs, and the line after a run, which decides if the run is a chip.
  while (first > 0 && inQuoteRun(block(first - 1))) {
    first--
  }
  while (last + 1 < count && inQuoteRun(block(last))) {
    last++
  }
  const blocks = Array.from({ length: last - first + 1 }, (_, index) => block(first + index))
  const lines = blocks.map(plainLine)
  // The block of each text line: a chip's block holds several lines.
  const blockOfLine = lines.flatMap((text, index) =>
    Array.from({ length: (text ?? KEPT_LINE).split('\n').length }, () => index)
  )
  const parsed = promptTextContent(lines.map((text) => text ?? KEPT_LINE).join('\n')).content ?? []
  const next: JSONContent[] = []
  let line = 0
  for (const json of parsed) {
    const token = json.content?.[0]?.type === QUOTE_NODE ? json.content[0].attrs?.token : null
    const index = blockOfLine[line]
    next.push(lines[index] === null ? blocks[index] : json)
    line += typeof token === 'string' ? token.split('\n').length : 1
  }
  const same =
    next.length === blocks.length &&
    next.every((node, index) => blockKey(node, index) === blockKey(blocks[index], index))
  return same ? null : { first, last, blocks: next }
}

/** A stored document with the chips its text has. */
export function withQuoteChipsParsed(document: JSONContent): JSONContent {
  const content = document.content ?? []
  const result = content.length
    ? reparseQuoteBlocks(content.length, (index) => content[index], 0, content.length - 1)
    : null
  return result ? { ...document, content: result.blocks } : document
}

export function seedPromptSkillReferences(
  node: JSONContent,
  skills: readonly AgentJournalSkillRef[] = [],
  occurrences = new Map<string, number>()
): JSONContent {
  if ((node.type === 'text' && node.text) || skills.length === 0) {
    return node
  }
  return {
    ...node,
    content: node.content?.flatMap((child) => {
      if (child.type !== 'text' || !child.text) {
        return [seedPromptSkillReferences(child, skills, occurrences)]
      }
      const pieces: JSONContent[] = []
      const text = child.text
      let start = 0
      const names = [...new Set(skills.map(({ name }) => name))]
        .sort((a, b) => b.length - a.length)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const pattern = new RegExp(`[$/](?:${names.join('|')})(?![\\w:-])`, 'gu')
      for (const match of text.matchAll(pattern)) {
        if (match[0].startsWith('/') && match.index > 0 && !/\s/u.test(text[match.index - 1])) {
          continue
        }
        const name = match[0].slice(1)
        const matching = skills.filter((skill) => skill.name === name)
        const occurrence = occurrences.get(name) ?? 0
        const skill = matching[occurrence] ?? matching[0]
        occurrences.set(name, occurrence + 1)
        if (!skill) {
          continue
        }
        if (match.index > start) {
          pieces.push({ type: 'text', text: text.slice(start, match.index) })
        }
        pieces.push({ type: 'nativeChatSkill', attrs: { token: match[0], path: skill.path } })
        start = match.index + match[0].length
      }
      if (start < text.length) {
        pieces.push({ type: 'text', text: text.slice(start) })
      }
      return pieces
    })
  }
}

/** The document side of withoutImageReference: each chip goes with one space after it. */
export function withoutImageReferenceNodes(
  document: JSONContent,
  attachmentId: string
): JSONContent {
  const isChip = (node: JSONContent | undefined): boolean =>
    node?.type === IMAGE_REFERENCE_NODE && node.attrs?.attachmentId === attachmentId
  return document.content
    ? {
        ...document,
        content: document.content.flatMap((node, index, nodes) => {
          if (isChip(node)) {
            return []
          }
          if (isChip(nodes[index - 1]) && node.type === 'text' && node.text?.startsWith(' ')) {
            const text = node.text.slice(1)
            return text ? [{ ...node, text }] : []
          }
          return [withoutImageReferenceNodes(node, attachmentId)]
        })
      }
    : document
}

/**
 * Applies an appended text change without replacing existing picked nodes.
 * `literal` (a paste) keeps quoted lines as text, also in a draft that has no document yet.
 */
export function appendPromptDocumentText(
  document: JSONContent | undefined,
  before: string,
  after: string,
  options?: { literal?: boolean }
): JSONContent | undefined {
  const base = document ?? (options?.literal ? promptTextContent(before) : undefined)
  if (!base || before === after) {
    return document
  }
  const kept = before.trimEnd()
  if (kept === '') {
    return promptTextContent(after, options)
  }
  const blocks = [...(base.content ?? [])]
  while (blocks.length > 0) {
    const block = blocks.pop()
    const content = [...(block?.content ?? [])]
    while (content.length > 0) {
      const node = content.at(-1)
      if (node?.type === 'hardBreak') {
        content.pop()
      } else if (node?.type === 'text') {
        const text = node.text?.trimEnd() ?? ''
        if (text === '') {
          content.pop()
        } else {
          content[content.length - 1] = { ...node, text }
          break
        }
      } else {
        break
      }
    }
    if (content.length > 0 && block) {
      const [first, ...rest] = promptTextContent(after.slice(kept.length), options).content ?? []
      const joined = [
        ...blocks,
        { ...block, content: [...content, ...(first?.content ?? [])] },
        ...rest
      ]
      // A paste stays literal; other text joins the quote runs it touches, as the sent text does.
      const chips = options?.literal
        ? null
        : reparseQuoteBlocks(
            joined.length,
            (index) => joined[index],
            Math.max(0, blocks.length - 1),
            joined.length - 1
          )
      return {
        ...base,
        content: chips ? [...joined.slice(0, chips.first), ...chips.blocks] : joined
      }
    }
  }
  return promptTextContent(after, options)
}

/** Slice serialized prompt offsets while retaining selected nodes inside the range. */
export function slicePromptDocument(document: JSONContent, from: number, to: number): JSONContent {
  let offset = 0
  const blocks: JSONContent[] = []
  for (const [index, block] of (document.content ?? []).entries()) {
    if (index > 0) {
      offset++
    }
    const start = offset
    const content: JSONContent[] = []
    for (const node of block.content ?? []) {
      const value = promptLeafString(node.type, node.attrs, node.text)
      const end = offset + value.length
      if (end > from && offset < to) {
        content.push(
          node.type === 'text'
            ? {
                ...node,
                text: value.slice(Math.max(0, from - offset), Math.min(value.length, to - offset))
              }
            : node
        )
      }
      offset = end
    }
    if (offset >= from && start <= to) {
      blocks.push({ ...block, content })
    }
  }
  return { ...document, content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}
