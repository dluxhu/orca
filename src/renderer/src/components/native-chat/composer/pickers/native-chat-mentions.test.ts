import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { agentReferenceToken } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import {
  filterNativeChatMentionSessions,
  listNativeChatMentionSessions
} from './native-chat-mentions'
import { serializeNativeChatAgentReferences } from './native-chat-agent-reference-send'

const agent = (paneKey: string, name: string, parentPaneKey: string | null = null) => ({
  paneKey,
  parentPaneKey,
  conversationName: name,
  displayName: null,
  taskTitle: null
})

const ps = {
  worktrees: [
    {
      displayName: 'repo/main',
      agents: [
        agent('structured-agent-session-chat_aaaaaaaa', 'Release notes'),
        agent('structured-agent-session-chat_bbbbbbbb', 'This chat'),
        agent(
          'structured-agent-session-chat_cccccccc',
          'Sub',
          'structured-agent-session-chat_aaaaaaaa'
        ),
        agent('tab-1:leaf-1', 'Terminal agent')
      ]
    }
  ]
}

const terminals = {
  terminals: [
    { handle: 'term_one', ptyId: 'pty-1', branch: 'main', title: 'zsh', paneTitle: 'Runner' },
    { handle: 'term_two', ptyId: 'pty-2', branch: 'main', title: 'zsh' },
    { handle: 'term_old', ptyId: null, branch: 'main', title: 'Gone', orphaned: true }
  ]
}

describe('listNativeChatMentionSessions', () => {
  it('lists top-level chats and live terminals, without the composer itself', () => {
    const sessions = listNativeChatMentionSessions(ps, terminals, 'local', {
      sessionId: 'chat_bbbbbbbb',
      ptyId: 'pty-2'
    })
    expect(sessions).toEqual([
      {
        kind: 'chat',
        label: 'Release notes',
        address: 'orca_session_id:chat_aaaaaaaa',
        hostKey: 'local',
        detail: 'repo/main'
      },
      { kind: 'terminal', label: 'Runner', address: 'term_one', hostKey: 'local', detail: 'main' }
    ])
  })

  it('keeps the other kind when one list failed', () => {
    expect(
      listNativeChatMentionSessions(null, terminals, 'local', {}).map((s) => s.address)
    ).toEqual(['term_one', 'term_two'])
  })

  it('filters by name, ignoring case', () => {
    const sessions = listNativeChatMentionSessions(ps, terminals, 'local', {})
    expect(filterNativeChatMentionSessions(sessions, 'RUN').map((s) => s.label)).toEqual(['Runner'])
  })
})

describe('serializeNativeChatAgentReferences for @ mentions', () => {
  it('tells the agent to use orca chat and orca terminal', () => {
    const chat = {
      label: 'Release notes',
      address: 'orca_session_id:chat_aaaaaaaa',
      hostKey: 'local',
      kind: 'chat' as const
    }
    const terminal = {
      label: 'Runner',
      address: 'term_one',
      hostKey: 'local',
      kind: 'terminal' as const
    }
    const document: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ask ' },
            { type: 'nativeChatAgentReference', attrs: chat },
            { type: 'text', text: ' and ' },
            { type: 'nativeChatAgentReference', attrs: terminal }
          ]
        }
      ]
    }
    const text = `ask ${agentReferenceToken(chat)} and ${agentReferenceToken(terminal)}`
    expect(serializeNativeChatAgentReferences(text, document)).toBe(
      [
        'ask @Release notes and @Runner',
        '',
        '[Orca chat "Release notes": session chat_aaaaaaaa — send it a message with orca chat send --session chat_aaaaaaaa --text <message>, and read its replies with orca chat read --session chat_aaaaaaaa]',
        '[Orca terminal "Runner": term_one — send it input with orca terminal send --terminal term_one --text <text> --enter, and read its output with orca terminal read --terminal term_one]'
      ].join('\n')
    )
  })

  it('keeps the orchestration note for a reference without a kind', () => {
    const crew = { label: 'Worker', address: 'term_one', hostKey: 'local' }
    const document: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'nativeChatAgentReference', attrs: crew }] }]
    }
    expect(serializeNativeChatAgentReferences(agentReferenceToken(crew), document)).toBe(
      '@Worker\n\n[Orca agent "Worker": term_one — message it with orca orchestration send --to term_one]'
    )
  })
})
