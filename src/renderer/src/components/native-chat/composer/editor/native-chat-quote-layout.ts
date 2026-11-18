import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { promptLeafString, QUOTE_LINE, QUOTE_NODE } from './native-chat-prompt-document-text'

/**
 * Starts a new line at each quote chip that has text or a pill before it on its line.
 * Why: the agent reads the chip as a Markdown blockquote, which must start a line. A chip after a
 * chip is correct: the chip before it ends in a blank line. A quote line before the chip gets a
 * blank line after it, or it joins the chip's blockquote.
 */
export function layoutQuoteChips(state: { doc: ProseMirrorNode; tr: Transaction }): Transaction {
  const { doc, tr } = state
  const splits: { position: number; afterQuoteLine: boolean }[] = []
  doc.descendants((node, position, parent, index) => {
    if (
      node.type.name !== QUOTE_NODE ||
      index === 0 ||
      parent?.child(index - 1).type.name === QUOTE_NODE
    ) {
      return
    }
    // The text line before the chip: the nodes after the previous chip, from the last line break.
    let start = index
    while (start > 0 && parent!.child(start - 1).type.name !== QUOTE_NODE) {
      start--
    }
    const before = Array.from({ length: index - start }, (_, at) => {
      const { type, attrs, text } = parent!.child(start + at)
      return promptLeafString(type.name, attrs, text)
    }).join('')
    splits.push({ position, afterQuoteLine: QUOTE_LINE.test(before.split('\n').at(-1)!) })
  })
  // From the end, so the positions still to split stay valid.
  for (const { position, afterQuoteLine } of splits.toReversed()) {
    tr.split(position)
    if (afterQuoteLine) {
      tr.insert(position + 1, doc.type.schema.nodes.paragraph.create())
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
