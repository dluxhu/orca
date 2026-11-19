// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

/** The quote sources as one app window sees them: each window loads the module on its own. */
async function appWindow() {
  vi.resetModules()
  return import('./native-chat-quote-sources')
}

const at = (messageId: string) => ({ messageId, place: null })

afterEach(() => localStorage.clear())

it('finds the source of a quote whose lines start with Markdown syntax', async () => {
  const sources = await appWindow()
  const quote = '# a comment\n- removed line\n1. step'
  sources.rememberNativeChatQuoteSource(quote, at('reply-1'))
  expect(sources.nativeChatQuoteSource(quote)?.messageId).toBe('reply-1')
})

it('stores a short entry for a very long quote, and still finds it', async () => {
  const sources = await appWindow()
  const quote = 'long quote line\n'.repeat(5000)
  sources.rememberNativeChatQuoteSource(quote, at('reply-1'))
  const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? '')
  expect(stored.join('').length).toBeLessThan(200)
  expect(stored.join('')).not.toContain('long quote line')
  expect(sources.nativeChatQuoteSource(quote)?.messageId).toBe('reply-1')
})

it('shares the sources between app windows without one window losing the other one', async () => {
  const first = await appWindow()
  const second = await appWindow()
  first.rememberNativeChatQuoteSource('alpha', at('m1'))
  second.rememberNativeChatQuoteSource('beta', at('m2'))
  first.rememberNativeChatQuoteSource('gamma', at('m3'))
  expect(first.nativeChatQuoteSource('beta')?.messageId).toBe('m2')
  expect(second.nativeChatQuoteSource('gamma')?.messageId).toBe('m3')
  expect((await appWindow()).nativeChatQuoteSource('beta')?.messageId).toBe('m2')
})

it('opens a Markdown preview quote with no line at the top of its file', async () => {
  const { quotedFileLocation } = await appWindow()
  expect(quotedFileLocation('docs/guide.md', true)).toEqual({ pathText: 'docs/guide.md', line: 1 })
  expect(quotedFileLocation('Terminal', true)).toBeNull()
  expect(quotedFileLocation('just some words', true)).toBeNull()
})
