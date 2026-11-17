// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  jumpToQuoteSource,
  nativeChatQuoteMessageId,
  quotedFileLocation,
  rememberNativeChatQuoteSource
} from './native-chat-quote-sources'

afterEach(() => localStorage.clear())

describe('quote sources', () => {
  it('finds the message of a quote by its text, whitespace aside', () => {
    rememberNativeChatQuoteSource('first line\nsecond  line', 'reply-1')
    expect(nativeChatQuoteMessageId('first line second line')).toBe('reply-1')
    expect(nativeChatQuoteMessageId('other text')).toBeNull()
  })

  it('keeps the newest 200 sources and survives bad storage', () => {
    for (let index = 0; index < 201; index++) {
      rememberNativeChatQuoteSource(`quote ${index}`, `m${index}`)
    }
    expect(nativeChatQuoteMessageId('quote 0')).toBeNull()
    expect(nativeChatQuoteMessageId('quote 200')).toBe('m200')
    localStorage.setItem('orca.nativeChat.quoteSources.v1', '{bad')
    expect(nativeChatQuoteMessageId('quote 200')).toBeNull()
  })

  it('reads the file and first line of an editor quote', () => {
    expect(quotedFileLocation('src/a b.ts:12-20')).toEqual({ pathText: 'src/a b.ts', line: 12 })
    expect(quotedFileLocation('README.md:3')).toEqual({ pathText: 'README.md', line: 3 })
    expect(quotedFileLocation('Terminal')).toBeNull()
    expect(quotedFileLocation('just some words')).toBeNull()
  })
})

describe('jumpToQuoteSource', () => {
  const deps = () => ({
    jumpToMessage: vi.fn(() => true),
    openFile: vi.fn(() => true),
    notifyMissing: vi.fn()
  })

  it('goes to the remembered message first', () => {
    rememberNativeChatQuoteSource('quoted', 'reply-1')
    const fake = deps()
    expect(jumpToQuoteSource('quoted', 'src/a.ts:1', fake)).toBe('message')
    expect(fake.jumpToMessage).toHaveBeenCalledWith('reply-1', 'quoted')
    expect(fake.openFile).not.toHaveBeenCalled()
  })

  it('opens the quoted file when no message is known or the message is gone', () => {
    rememberNativeChatQuoteSource('quoted', 'gone')
    const fake = { ...deps(), jumpToMessage: vi.fn(() => false) }
    expect(jumpToQuoteSource('quoted', 'src/a.ts:7-9', fake)).toBe('file')
    expect(fake.openFile).toHaveBeenCalledWith({ pathText: 'src/a.ts', line: 7 })
  })

  it('shows a notice when the quote has no source to go back to', () => {
    const fake = deps()
    expect(jumpToQuoteSource('typed by hand', 'typed by hand', fake)).toBe('missing')
    expect(fake.notifyMissing).toHaveBeenCalledOnce()
    expect(fake.jumpToMessage).not.toHaveBeenCalled()
  })
})
