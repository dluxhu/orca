import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'

export const CHAT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['chat', 'rename'],
    summary: 'Rename a chat tab',
    usage: 'orca chat rename [--session <id>] --name <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'name'],
    notes: [
      '--session takes the chat session id `orca agent launch` prints. Run inside a chat, it defaults to that chat; with --environment it is required.',
      'The name shows in the tab, the sidebar, Session History and on paired phones, the same as renaming the tab by hand.'
    ],
    examples: [
      'orca chat rename --name "Migrate auth to OAuth"',
      'orca chat rename --session <sessionId> --name "Release notes" --json'
    ]
  },
  {
    path: ['chat', 'list'],
    summary: 'List agent chats with their workspace, state and last reply',
    usage: 'orca chat list [--state <state>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'state'],
    notes: [
      'Lists the top-level chats Orca shows as agent tabs. Terminal agents are read with `orca terminal`.',
      '--state keeps chats in one state: working, blocked, waiting or done.'
    ],
    examples: ['orca chat list --json', 'orca chat list --state working']
  },
  {
    path: ['chat', 'read'],
    summary: 'Read the latest messages of an agent chat',
    usage: 'orca chat read --session <id> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'limit'],
    notes: [
      '--session takes the session id from `orca chat list` or `orca agent launch`.',
      '--limit is the number of entries shown (messages, tool calls, errors, approvals and questions); the default is 20 and the maximum 100.',
      'Approvals and questions waiting for an answer are marked "waiting for you".',
      'With --json, truncated: true means older rows exist that the 200-row read did not reach.',
      'A paired host (--environment, --pairing-code) must support CLI chat read and send; older hosts refuse it.'
    ],
    examples: ['orca chat read --session codex_1234 --limit 10 --json']
  },
  {
    path: ['chat', 'send'],
    summary: 'Send a message to an agent chat',
    usage: 'orca chat send --session <id> (--text <text> | --text-file <path|->) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'text', 'text-file'],
    notes: [
      'Sends the text as your message, as if typed in the chat. --text-file - reads it from stdin.',
      'While the agent is working, hosts with a message queue hold the message until the turn ends; the result says "queued".',
      'A chat that restarted since it was read refuses the send; read it again and resend.',
      'A paired host (--environment, --pairing-code) must support CLI chat read and send; older hosts refuse it.'
    ],
    examples: [
      'orca chat send --session codex_1234 --text "Run the tests, then summarize failures"',
      'cat notes.md | orca chat send --session codex_1234 --text-file - --json'
    ]
  }
]
