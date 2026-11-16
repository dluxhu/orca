import type { Transaction } from '@tiptap/pm/state'
import { reparseQuoteBlocks } from './native-chat-prompt-document-text'

/**
 * Makes the quote chips of the blocks that `from`..`to` touches equal to what the composer parser
 * reads from their text. The text stays the same, so text offsets stay valid.
 * Why: a programmatic write changes the text a chip sends; the chip must show that text.
 */
export function reparseQuoteChips(tr: Transaction, from: number, to: number): void {
  const { doc } = tr
  if (doc.childCount === 0) {
    return
  }
  const blockAt = (position: number): number =>
    Math.min(doc.resolve(Math.min(position, doc.content.size)).index(0), doc.childCount - 1)
  const result = reparseQuoteBlocks(
    doc.childCount,
    (index) => doc.child(index).toJSON(),
    Math.max(0, blockAt(from) - 1),
    blockAt(to)
  )
  if (!result) {
    return
  }
  let start = 0
  for (let index = 0; index < result.first; index++) {
    start += doc.child(index).nodeSize
  }
  let end = start
  for (let index = result.first; index <= result.last; index++) {
    end += doc.child(index).nodeSize
  }
  tr.replaceWith(
    start,
    end,
    result.blocks.map((block) => doc.type.schema.nodeFromJSON(block))
  )
}
