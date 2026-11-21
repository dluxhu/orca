import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareLegacyTranscriptImport } from '../agent-session-journal/history-import/journal-legacy-import'
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

// An import replaces the journal, so the decoded transcript is the only source of dividers.
it('imports a /compact transcript with one divider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-compact-import-'))
  try {
    const at = (second: number) => `2026-11-21T10:00:0${second}.000Z`
    const user = (uuid: string, second: number, content: string, extra = {}) => ({
      type: 'user',
      uuid,
      sessionId: 'claude-compacted',
      timestamp: at(second),
      message: { role: 'user', content },
      ...extra
    })
    const rows = [
      user('prompt', 0, 'Hello'),
      {
        type: 'assistant',
        uuid: 'reply',
        sessionId: 'claude-compacted',
        timestamp: at(1),
        message: { id: 'msg-1', role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }
      },
      { type: 'system', subtype: 'turn_duration', uuid: 'turn-1', timestamp: at(2) },
      user(
        'command',
        3,
        '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>'
      ),
      JSON.parse(boundary('manual')),
      user('summary', 5, 'This session is being continued from a previous conversation.', {
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true
      }),
      user('stdout', 6, '<local-command-stdout>Compacted</local-command-stdout>', { isMeta: true })
    ]
    const filePath = join(root, 'claude-compacted.jsonl')
    await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const prepared = await prepareLegacyTranscriptImport({
      agent: 'claude',
      sessionId: 'claude-compacted',
      options: { filePath }
    })
    expect(prepared.ok).toBe(true)
    const dividers = (prepared.ok ? prepared.items : []).filter(
      ({ body }) =>
        body.kind === 'message' &&
        body.blocks.some((block) => block.type === 'text' && block.presentation === 'compaction')
    )
    expect(dividers.map(({ body }) => body)).toEqual([
      {
        kind: 'message',
        role: 'system',
        blocks: [{ type: 'text', text: 'Context compacted', presentation: 'compaction' }]
      }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
