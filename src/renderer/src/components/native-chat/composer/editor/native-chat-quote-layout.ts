import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { promptLeafString, QUOTE_LINE, QUOTE_NODE } from './native-chat-prompt-document-text'

/**
 * True when Markdown continues an earlier blockquote into the chip at `position`: a line in the
 * run of non-blank lines directly above the chip's line is a quote line.
 */
function continuesBlockquote(
  doc: ProseMirrorNode,
  position: number,
  startsBlock: boolean
): boolean {
  const lines = doc
    .textBetween(0, position, '\n', ({ type, attrs, text }) =>
      promptLeafString(type.name, attrs, text)
    )
    .split('\n')
  // A chip that starts its block: the text before it ends at the block's own empty start.
  let line = lines.length - (startsBlock ? 2 : 1)
  for (; line >= 0 && lines[line].trim() !== ''; line--) {
    if (QUOTE_LINE.test(lines[line])) {
      return true
    }
  }
  return false
}

/**
 * Keeps each quote chip a blockquote of its own in the text the agent gets.
 * A chip with text or a pill before it on its line starts a new line: a blockquote starts a line.
 * A chip line directly under a run of lines with a quote line gets a blank line above it:
 * Markdown otherwise continues that blockquote into the chip's. A chip after a chip ends in a
 * blank line already.
 */
export function layoutQuoteChips(state: { doc: ProseMirrorNode; tr: Transaction }): Transaction {
  const { doc, tr } = state
  const edits: { position: number; split: boolean; blankLine: boolean }[] = []
  doc.forEach((block, blockOffset) => {
    block.forEach((node, offset, index) => {
      if (node.type.name !== QUOTE_NODE || block.maybeChild(index - 1)?.type.name === QUOTE_NODE) {
        return
      }
      const position = blockOffset + 1 + offset
      const blankLine = continuesBlockquote(doc, position, index === 0)
      if (index > 0 || blankLine) {
        edits.push({ position, split: index > 0, blankLine })
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
