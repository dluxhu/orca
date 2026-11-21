import { describe, expect, it } from 'vitest'
import { isNativeChatCompactionBoundary } from '../../../shared/native-chat/native-chat-context-usage'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders-claude'

// The record Claude Code writes to its transcript where it compacts the conversation.
function boundary(trigger: 'auto' | 'manual'): string {
  return JSON.stringify({
    parentUuid: null,
    logicalParentUuid: 'last-reply',
    isSidechain: false,
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: '2026-11-21T10:00:00.000Z',
    uuid: `${trigger}-boundary`,
    level: 'info',
    compactMetadata: { trigger, preTokens: 167_000 }
  })
}

describe('Claude transcript compact boundary', () => {
  it('decodes an automatic compaction as a context boundary row', () => {
    const decoded = decodeClaudeTranscriptLine(boundary('auto'), 'fallback')
    expect(decoded).toEqual({
      id: 'auto-boundary',
      role: 'system',
      blocks: [
        { type: 'text', text: 'Context compacted automatically', presentation: 'compaction' }
      ],
      timestamp: Date.parse('2026-11-21T10:00:00.000Z'),
      source: 'transcript'
    })
    expect(isNativeChatCompactionBoundary(decoded!)).toBe(true)
  })

  it('decodes a /compact boundary with the plain label', () => {
    expect(decodeClaudeTranscriptLine(boundary('manual'), 'fallback')?.blocks).toEqual([
      { type: 'text', text: 'Context compacted', presentation: 'compaction' }
    ])
  })
})
