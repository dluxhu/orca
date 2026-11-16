import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { QUOTE_NODE } from './native-chat-prompt-document-text'

/**
 * Keeps each quote chip on its own line, with a blank line before the text below it.
 * Why: the agent reads the chip as a Markdown blockquote; text on its line or directly below it
 * would join the quote.
 */
export function layoutQuoteChips(state: { doc: ProseMirrorNode; tr: Transaction }): Transaction {
  const { doc, tr } = state
  const paragraph = doc.type.schema.nodes.paragraph
  // From the end, so the positions still to visit stay valid.
  for (let index = doc.childCount - 1, end = doc.content.size; index >= 0; index--) {
    const block = doc.child(index)
    const start = end - block.nodeSize
    const next = index + 1 < doc.childCount ? doc.child(index + 1) : null
    if (block.lastChild?.type.name === QUOTE_NODE && next && next.content.size > 0) {
      tr.insert(end, paragraph.create())
    }
    const chips: { from: number; to: number; first: boolean; last: boolean }[] = []
    block.forEach((node, offset, child) => {
      if (node.type.name === QUOTE_NODE) {
        const from = start + 1 + offset
        chips.push({
          from,
          to: from + node.nodeSize,
          first: child === 0,
          last: child === block.childCount - 1
        })
      }
    })
    for (const chip of chips.toReversed()) {
      if (!chip.last) {
        tr.split(chip.to)
        tr.insert(chip.to + 1, paragraph.create())
      }
      if (!chip.first) {
        tr.split(chip.from)
      }
    }
    end = start
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
      // Text typed at a split point stays on the side it was typed.
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
