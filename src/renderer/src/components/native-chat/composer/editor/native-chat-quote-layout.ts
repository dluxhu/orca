import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { promptLeafString, QUOTE_LINE, QUOTE_NODE } from './native-chat-prompt-document-text'

const lastLine = (nodes: readonly ProseMirrorNode[]): string =>
  nodes
    .map(({ type, attrs, text }) => promptLeafString(type.name, attrs, text))
    .join('')
    .split('\n')
    .at(-1)!

/**
 * Keeps each quote chip a blockquote of its own in the text the agent gets.
 * A chip with text or a pill before it on its line starts a new line: a blockquote starts a line.
 * A chip whose line comes after a quote line gets a blank line between: Markdown otherwise joins
 * that quote line to the chip's blockquote. A chip after a chip ends in a blank line already.
 */
export function layoutQuoteChips(state: { doc: ProseMirrorNode; tr: Transaction }): Transaction {
  const { doc, tr } = state
  const edits: { position: number; split: boolean; blankLine: boolean }[] = []
  doc.forEach((block, blockOffset, blockIndex) => {
    const children = block.content.content
    block.forEach((node, offset, index) => {
      if (node.type.name !== QUOTE_NODE || children[index - 1]?.type.name === QUOTE_NODE) {
        return
      }
      const before =
        index > 0
          ? children.slice(0, index)
          : (doc.maybeChild(blockIndex - 1)?.content.content ?? [])
      const blankLine = QUOTE_LINE.test(lastLine(before))
      if (index > 0 || blankLine) {
        edits.push({ position: blockOffset + 1 + offset, split: index > 0, blankLine })
      }
    })
  })
  // From the end, so the positions still to change stay valid.
  for (const { position, split, blankLine } of edits.toReversed()) {
    if (split) {
      tr.split(position)
    }
    if (blankLine) {
      // Between the line before and the chip's line.
      tr.insert(split ? position + 1 : position - 1, doc.type.schema.nodes.paragraph.create())
    }
  }
  return tr
}

export const nativeChatQuoteLayout = new Plugin({
  appendTransaction: (transactions, _old, state) => {
    // Programmatic writes (preventUpdate) must keep the text they set.
    if (!transactions.some((tr) => tr.docChanged && !tr.getMeta('preventUpdate'))) {
      return null
    }
    const tr = layoutQuoteChips(state)
    if (!tr.docChanged) {
      return null
    }
    const { selection } = state
    if (selection instanceof TextSelection) {
      // Text typed before a chip stays on the line above it.
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          tr.mapping.map(selection.anchor, -1),
          tr.mapping.map(selection.head, -1)
        )
      )
    }
    return tr
  }
})
