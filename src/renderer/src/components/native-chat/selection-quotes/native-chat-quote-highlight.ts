const HIGHLIGHT = 'native-chat-quote-jump'
export const QUOTE_HIGHLIGHT_MS = 1500

/** The range of `text` in `root`, matched without whitespace, as a selection reads it. */
export function quotedTextRange(root: HTMLElement, text: string): Range | null {
  const needle = text.replace(/\s+/g, '')
  if (!needle) {
    return null
  }
  const chars: { node: Text; offset: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const { data } = node as Text
    for (let offset = 0; offset < data.length; offset++) {
      if (!/\s/.test(data[offset])) {
        chars.push({ node: node as Text, offset })
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
    highlights.set(HIGHLIGHT, new Highlight(range))
    window.setTimeout(() => highlights.delete(HIGHLIGHT), QUOTE_HIGHLIGHT_MS)
  }
}
