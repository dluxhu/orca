import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { promptTextContent, QUOTE_NODE } from './native-chat-prompt-document-text'
import { promptTextOffset, promptTextPosition } from './native-chat-prompt-document'

const QUOTE_LINE = /^>( |$)/
// A line that is not a quote line and not blank: it holds the place of a line with other pills.
const KEPT_LINE = 'x'

/** A line of text and quote chips only; other pills keep their line as it is. */
function plainLine(block: ProseMirrorNode): string | null {
  let text = ''
  let plain = block.type.name === 'paragraph'
  block.forEach((child) => {
    plain &&= child.isText || child.type.name === QUOTE_NODE
    text += child.isText ? (child.text ?? '') : String(child.attrs.token)
  })
  return plain ? text : null
}

function inQuoteRun(block: ProseMirrorNode): boolean {
  const line = plainLine(block)
  return line !== null && QUOTE_LINE.test(line)
}

/**
 * Makes the quote chips of the blocks that `from`..`to` touches equal to what the composer parser
 * reads from their text. The text stays the same, so text offsets and the caret stay valid.
 * Why: a programmatic write changes the text a chip sends; the chip must show that text.
 */
export function reparseQuoteChips(tr: Transaction, from: number, to: number): void {
  const { doc } = tr
  if (doc.childCount === 0) {
    return
  }
  const blockAt = (position: number): number =>
    Math.min(doc.resolve(Math.min(position, doc.content.size)).index(0), doc.childCount - 1)
  let first = Math.max(0, blockAt(from) - 1)
  let last = Math.min(doc.childCount - 1, blockAt(to) + 1)
  // Whole quote runs, and the line after a run, which decides if the run is a chip.
  while (first > 0 && inQuoteRun(doc.child(first - 1))) {
    first--
  }
  while (last + 1 < doc.childCount && inQuoteRun(doc.child(last))) {
    last++
  }
  const blocks = Array.from({ length: last - first + 1 }, (_, index) => doc.child(first + index))
  const lines = blocks.map((block) => plainLine(block))
  // The block of each text line: a chip's block holds several lines.
  const blockOfLine = lines.flatMap((text, index) =>
    Array.from({ length: (text ?? KEPT_LINE).split('\n').length }, () => index)
  )
  const parsed = promptTextContent(lines.map((text) => text ?? KEPT_LINE).join('\n')).content ?? []
  const next: ProseMirrorNode[] = []
  let line = 0
  for (const json of parsed) {
    const token = json.content?.[0]?.type === QUOTE_NODE ? json.content[0].attrs?.token : null
    const block = blockOfLine[line]
    next.push(lines[block] === null ? blocks[block] : doc.type.schema.nodeFromJSON(json))
    line += typeof token === 'string' ? token.split('\n').length : 1
  }
  const fragment = Fragment.from(next)
  if (fragment.eq(Fragment.from(blocks))) {
    return
  }
  let start = 0
  for (let index = 0; index < first; index++) {
    start += doc.child(index).nodeSize
  }
  const end = start + blocks.reduce((size, block) => size + block.nodeSize, 0)
  const selection = tr.selection
  const anchor = promptTextOffset(doc, selection.anchor)
  const head = promptTextOffset(doc, selection.head)
  tr.replaceWith(start, end, fragment)
  if (selection instanceof TextSelection) {
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        promptTextPosition(tr.doc, anchor),
        promptTextPosition(tr.doc, head)
      )
    )
  }
}
