const HIGHLIGHT = 'native-chat-quote-jump'
export const QUOTE_HIGHLIGHT_MS = 1500

// Letters only: the sent quote is Markdown, so it can lose marks and list numbers that its source shows.
const KEPT = /\p{L}/u

/** The range of `text` in `root`, matched on letters only. */
export function quotedTextRange(root: HTMLElement, text: string): Range | null {
  const needle = text.replace(/\P{L}/gu, '')
  if (!needle) {
    return null
  }
  const chars: { node: Text; offset: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      continue
    }
    for (let offset = 0; offset < node.data.length; offset++) {
      if (KEPT.test(node.data[offset])) {
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

/** Moves focus to the quoted text's source and highlights the text there for a short time. */
export function showQuotedText(source: HTMLElement, text: string): void {
  const range = quotedTextRange(source, text)
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
