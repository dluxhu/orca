// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { QUOTE_HIGHLIGHT_MS, quotedTextRange, showQuotedText } from './native-chat-quote-highlight'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function source(): HTMLElement {
  const element = document.createElement('div')
  element.innerHTML = '<p>Before. The <strong>quoted</strong>\ntext here.</p><p>After.</p>'
  document.body.append(element)
  return element
}

it('finds quoted text across elements and line breaks', () => {
  expect(quotedTextRange(source(), 'The quoted text')?.toString()).toBe('The quoted\ntext')
  expect(quotedTextRange(source(), 'not there')).toBeNull()
})

it('moves focus to the source and highlights the quoted text for a short time', () => {
  vi.useFakeTimers()
  const highlights = new Map<string, { range: Range }>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal(
    'Highlight',
    class {
      constructor(readonly range: Range) {}
    }
  )
  const element = source()
  element.scrollIntoView = vi.fn()
  for (const child of element.querySelectorAll('*')) {
    if (child instanceof HTMLElement) {
      child.scrollIntoView = vi.fn()
    }
  }
  showQuotedText(element, 'quoted text')
  expect(document.activeElement).toBe(element)
  expect(highlights.get('native-chat-quote-jump')?.range.toString()).toBe('quoted\ntext')
  vi.advanceTimersByTime(QUOTE_HIGHLIGHT_MS)
  expect(highlights.has('native-chat-quote-jump')).toBe(false)
})

it('finds quoted text whose Markdown marks the page does not show', () => {
  const element = document.createElement('div')
  element.innerHTML = '<h1>a comment</h1><ul><li>removed line</li></ul>'
  document.body.append(element)
  expect(quotedTextRange(element, '# a comment\n- removed line')?.toString()).toBe(
    'a commentremoved line'
  )
})

it('keeps the highlight of a second jump when the first one times out', () => {
  vi.useFakeTimers()
  const highlights = new Map<string, { range: Range }>()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal(
    'Highlight',
    class {
      constructor(readonly range: Range) {}
    }
  )
  const element = source()
  for (const child of element.querySelectorAll('*')) {
    if (child instanceof HTMLElement) {
      child.scrollIntoView = vi.fn()
    }
  }
  showQuotedText(element, 'quoted text')
  vi.advanceTimersByTime(QUOTE_HIGHLIGHT_MS - 500)
  showQuotedText(element, 'Before')
  vi.advanceTimersByTime(600)
  expect(highlights.get('native-chat-quote-jump')?.range.toString()).toBe('Before')
  vi.advanceTimersByTime(QUOTE_HIGHLIGHT_MS)
  expect(highlights.has('native-chat-quote-jump')).toBe(false)
})
