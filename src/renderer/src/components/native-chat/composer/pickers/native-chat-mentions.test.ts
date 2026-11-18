import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { agentReferenceToken } from '../../../../../../shared/orchestration/mailbox/orchestration-agent-reference'
import { listNativeChatMentionSessionRows } from '../../../../../../shared/native-chat/native-chat-mention-sessions'
import { filterNativeChatMentionSessions } from './native-chat-mentions'
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

const local = (rows: ReturnType<typeof listNativeChatMentionSessionRows>) =>
  rows.map((row) => ({ ...row, hostKey: 'local' }))

describe('listNativeChatMentionSessionRows', () => {
  it('lists top-level chats and live terminals, without the composer itself', () => {
    const sessions = listNativeChatMentionSessionRows(ps, terminals, {
      sessionId: 'chat_bbbbbbbb',
      ptyId: 'pty-2'
    })
    expect(sessions).toEqual([
      {
        kind: 'chat',
        label: 'Release notes',
        address: 'orca_session_id:chat_aaaaaaaa',
        detail: 'repo/main'
      },
      { kind: 'terminal', label: 'Runner', address: 'term_one', detail: 'main' }
    ])
  })

  it('keeps the other kind when one list failed', () => {
    expect(
      listNativeChatMentionSessionRows(null, terminals, {}).map((s) => s.address)
    ).toEqual(['term_one', 'term_two'])
  })

  it('filters by name, ignoring case', () => {
    const sessions = local(listNativeChatMentionSessionRows(ps, terminals, {}))
    expect(filterNativeChatMentionSessions(sessions, 'RUN').map((s) => s.label)).toEqual(['Runner'])
  })

  it('filters by workspace name too', () => {
    const sessions = local(listNativeChatMentionSessionRows(ps, terminals, {}))
    expect(filterNativeChatMentionSessions(sessions, 'REPO/').map((s) => s.label)).toEqual([
      'Release notes',
      'This chat'
    ])
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

  it('names the environment of a chat or terminal on another host', () => {
    const chat = {
      label: 'Notes (laptop)',
      address: 'orca_session_id:chat_aaaaaaaa',
      hostKey: 'local:laptop',
      kind: 'chat' as const,
      environment: 'laptop'
    }
    const terminal = {
      label: 'Runner (my box)',
      address: 'term_one',
      hostKey: 'local:my box',
      kind: 'terminal' as const,
      environment: 'my box'
    }
    const document: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'nativeChatAgentReference', attrs: chat },
            { type: 'text', text: ' ' },
            { type: 'nativeChatAgentReference', attrs: terminal }
          ]
        }
      ]
    }
    const text = `${agentReferenceToken(chat)} ${agentReferenceToken(terminal)}`
    expect(serializeNativeChatAgentReferences(text, document)).toBe(
      [
        '@Notes (laptop) @Runner (my box)',
        '',
        '[Orca chat "Notes (laptop)": session chat_aaaaaaaa — send it a message with orca chat send --environment laptop --session chat_aaaaaaaa --text <message>, and read its replies with orca chat read --environment laptop --session chat_aaaaaaaa]',
        "[Orca terminal \"Runner (my box)\": term_one — send it input with orca terminal send --environment 'my box' --terminal term_one --text <text> --enter, and read its output with orca terminal read --environment 'my box' --terminal term_one]"
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
