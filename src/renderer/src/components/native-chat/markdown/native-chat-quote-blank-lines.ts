import type { Root, RootContent } from 'mdast'

/**
 * Shows the empty lines a user typed next to a quote. The text has one blank line more there:
 * that one only keeps the quote apart from the text, so it stays hidden, as Markdown hides it.
 */
export function remarkNativeChatQuoteBlankLines() {
  return (tree: Root): void => {
    const children: RootContent[] = []
    tree.children.forEach((node, index) => {
      const previous = tree.children[index - 1]
      if (previous && (previous.type === 'blockquote' || node.type === 'blockquote')) {
        const typed = (node.position?.start.line ?? 0) - (previous.position?.end.line ?? 0) - 2
        for (let line = 0; line < typed; line++) {
          children.push({ type: 'paragraph', children: [{ type: 'break' }] })
        }
      }
      children.push(node)
    })
    tree.children = children
  }
}
