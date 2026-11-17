import { textHash, type QuotePlace } from './native-chat-quote-sources'

const HIGHLIGHT = 'native-chat-quote-jump'
export const QUOTE_HIGHLIGHT_MS = 1500

function textNodes(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      nodes.push(node)
    }
  }
  return nodes
}

/** Where `range` is in the text of `source`: the selection that "Add to chat" takes. */
export function quotePlace(source: Element, range: Range): QuotePlace {
  const clamped = range.cloneRange()
  if (!source.contains(clamped.startContainer)) {
    clamped.setStart(source, 0)
  }
  if (!source.contains(clamped.endContainer)) {
    clamped.setEnd(source, source.childNodes.length)
  }
  const before = document.createRange()
  before.setStart(source, 0)
  before.setEnd(clamped.startContainer, clamped.startOffset)
  const text = clamped.toString()
  return { offset: before.toString().length, length: text.length, hash: textHash(text) }
}

/** The range at `place` in the text of `root`, while the text there is still the quoted text. */
export function placeRange(root: HTMLElement, place: QuotePlace): Range | null {
  const range = document.createRange()
  let start = place.offset
  let end = place.offset + place.length
  let started = false
  for (const node of textNodes(root)) {
    // `<`: a quote that starts where a text node ends starts in the next one.
    if (!started && start < node.data.length) {
      range.setStart(node, start)
      started = true
    }
    if (started && end <= node.data.length) {
      range.setEnd(node, end)
      return textHash(range.toString()) === place.hash ? range : null
    }
    start -= node.data.length
    end -= node.data.length
  }
  return null
}

/**
 * The first range of `text` in `root`, for a reply drawn again since the quote. The compare skips
 * whitespace only: a selection has line breaks between blocks that the page text does not have.
 */
export function quotedTextRange(root: HTMLElement, text: string): Range | null {
  const needle = text.replace(/\s/g, '')
  if (!needle) {
    return null
  }
  const chars: { node: Text; offset: number }[] = []
  for (const node of textNodes(root)) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset])) {
        chars.push({ node, offset })
      }
    }
  }
  const index = chars
    .map(({ node, offset }) => node.data[offset])
    .join('')
    .indexOf(needle)
  if (index === -1) {
    return null
  }
  const first = chars[index]
  const last = chars[index + needle.length - 1]
  const range = document.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}

/**
 * Moves focus to the quote's source and highlights the quote there for a short time: at its saved
 * place, or where the text is found when the reply changed since.
 */
export function showQuotedText(source: HTMLElement, text: string, place: QuotePlace | null): void {
  const range = (place && placeRange(source, place)) ?? quotedTextRange(source, text)
  // Focus moves too, so the highlight is not the only signal.
  if (!source.hasAttribute('tabindex')) {
    source.tabIndex = -1
  }
  source.focus({ preventScroll: true })
  range?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  const highlights = globalThis.CSS?.highlights
  if (range && highlights && typeof Highlight !== 'undefined') {
    const highlight = new Highlight(range)
    highlights.set(HIGHLIGHT, highlight)
    // A later jump keeps its own highlight for its whole time.
    window.setTimeout(() => {
      if (highlights.get(HIGHLIGHT) === highlight) {
        highlights.delete(HIGHLIGHT)
      }
    }, QUOTE_HIGHLIGHT_MS)
  }
}
