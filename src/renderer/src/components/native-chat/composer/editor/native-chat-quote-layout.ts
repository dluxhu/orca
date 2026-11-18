import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { QUOTE_NODE } from './native-chat-prompt-document-text'

/**
 * Keeps each quote chip on its own line, with a blank line between it and the text above and below.
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
        tr.insert(chip.from + 1, paragraph.create())
      }
    }
    const previous = index > 0 ? doc.child(index - 1) : null
    if (block.firstChild?.type.name === QUOTE_NODE && previous && previous.content.size > 0) {
      tr.insert(start, paragraph.create())
    }
    end = start
  }
  return tr
}

const isChipLine = (block: ProseMirrorNode | null): boolean =>
  block?.childCount === 1 && block.firstChild?.type.name === QUOTE_NODE

/**
 * The blank lines that keep a chip apart from the text next to it: the first empty line below a
 * chip, unless it is the last line, and the last empty line above a chip that has text above it.
 * The text keeps them; the composer hides them. More empty lines are the user's.
 */
function separatorLines(doc: ProseMirrorNode): Set<number> {
  const separators = new Set<number>()
  for (let index = 0; index < doc.childCount; index++) {
    if (doc.child(index).content.size > 0) {
      continue
    }
    let last = index
    while (last + 1 < doc.childCount && doc.child(last + 1).content.size === 0) {
      last++
    }
    const before = index > 0 ? doc.child(index - 1) : null
    const after = last + 1 < doc.childCount ? doc.child(last + 1) : null
    if (isChipLine(before) && (after || last > index)) {
      separators.add(index)
    } else if (before && isChipLine(after)) {
      separators.add(last)
    }
    index = last
  }
  return separators
}

/**
 * The position of the chip that Backspace (-1) or Delete (1) at the caret selects. The hidden line
 * belongs to its chip, so the key selects the chip when the caret is on that line, or on the next
 * line past it when that line has text or is the edge line of the document. Null in other cases.
 */
export function chipPastSeparator(
  { doc, selection }: EditorState,
  direction: -1 | 1
): number | null {
  const { $head } = selection
  if (
    !selection.empty ||
    $head.depth !== 1 ||
    $head.parentOffset !== (direction < 0 ? 0 : $head.parent.content.size)
  ) {
    return null
  }
  const index = $head.index(0)
  const separators = separatorLines(doc)
  const chipAt = (at: number): boolean =>
    at >= 0 && at < doc.childCount && isChipLine(doc.child(at))
  const edgeLine = direction < 0 ? doc.childCount - 1 : 0
  const chip =
    separators.has(index) && chipAt(index + direction)
      ? index + direction
      : separators.has(index + direction) &&
          chipAt(index + 2 * direction) &&
          ($head.parent.content.size > 0 || index === edgeLine)
        ? index + 2 * direction
        : null
  if (chip === null) {
    return null
  }
  let position = 0
  for (let at = 0; at < chip; at++) {
    position += doc.child(at).nodeSize
  }
  return position + 1
}

/** Hides each separator line. A caret on it shows it, so the caret is never out of sight. */
export function quoteSeparatorDecorations({ doc, selection }: EditorState): DecorationSet {
  const offsets: number[] = []
  doc.forEach((_block, offset) => offsets.push(offset))
  const decorations = [...separatorLines(doc)]
    .filter((index) => index !== selection.$head.index(0))
    .map((index) =>
      Decoration.node(offsets[index], offsets[index] + doc.child(index).nodeSize, {
        class: 'hidden',
        'data-quote-separator': ''
      })
    )
  return DecorationSet.create(doc, decorations)
}

export const nativeChatQuoteLayout = new Plugin({
  props: { decorations: quoteSeparatorDecorations },
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
