import { randomUUID } from 'node:crypto'
import type { CommandHandler } from '../dispatch/dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getPresentStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { printResult } from '../output/command-result-output'
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import {
  AGENT_SESSION_HISTORY_MAX_LIMIT,
  type AgentSessionHistoryResult,
  type AgentSessionMutationResult,
  type AgentSessionSendResult
} from '../../shared/agent-session/agent-session-wire'
import { AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY } from '../../shared/agent-session/agent-session-runtime-capabilities'
import {
  AGENT_SESSION_UNATTACHED_REFUSAL_CODE,
  isUnattachedAgentSessionReadRefusal
} from '../../shared/agent-session/failures/structured-agent-session-read-refusal'
import { createStructuredAgentSessionOperationId } from '../../shared/agent-session/lifecycle/operations/structured-agent-session-mutation'
import {
  structuredAgentSessionMessageSendMutation,
  structuredAgentSessionSendBody
} from '../../shared/agent-session/requests/structured-agent-session-send-mutation'
import { AGENT_STATUS_STATES } from '../../shared/agent-status/contracts/agent-status-types'
import type { RuntimeWorktreePsResult } from '../../shared/worktree/catalog/runtime-worktree-contracts'
import {
  chatTranscript,
  formatChatList,
  formatChatRead,
  listChatSessions,
  parseChatSessionSelector
} from './chat-sessions'

type ChatRenameResult = { name: string | null; applied: boolean }

// Orca @dLux patch "Chat CLI" (list/read/send): see PATCHES.md.
const DEFAULT_READ_LIMIT = 20
const MAX_READ_LIMIT = 100

function readSession(flags: Map<string, string | boolean>): string {
  return parseChatSessionSelector(getRequiredStringFlag(flags, 'session'))
}

function readHistory(client: RuntimeClient, session: string, limit: number, action: string) {
  return client
    .call<AgentSessionHistoryResult>('agentSession.history', {
      sessionId: session,
      direction: 'tail',
      limit
    })
    .catch((error: unknown) => {
      throw explainChatRefusal(error, session, action)
    })
}

export const CHAT_HANDLERS: Record<string, CommandHandler> = {
  'chat rename': async ({ flags, client, json }) => {
    const name = getRequiredStringFlag(flags, 'name')
    // An empty --session must not fall back to this chat; the injected id is local-only.
    const sessionId =
      getPresentStringFlag(flags, 'session') ??
      (client.isRemote ? undefined : readInjectedAgentSessionId())
    if (!sessionId) {
      throw new RuntimeClientError(
        'invalid_argument',
        client.isRemote
          ? 'Missing required --session: on a paired host, name the chat by its session id.'
          : 'Missing required --session: this is not running inside a chat, so name the chat by its session id.'
      )
    }
    const result = await client
      .call<ChatRenameResult>('agentSession.rename', { sessionId, name })
      .catch((error: unknown) => {
        throw explainChatRefusal(error, sessionId, 'rename')
      })
    if (!result.result.applied) {
      throw new RuntimeClientError('invalid_argument', 'Not renamed: the name has no visible text.')
    }
    printResult(result, json, (value) => `Renamed chat to "${value.name}".`)
  },
  'chat list': async ({ flags, client, json }) => {
    const state = getOptionalStringFlag(flags, 'state')
    if (state !== undefined && !AGENT_STATUS_STATES.some((known) => known === state)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--state must be one of: ${AGENT_STATUS_STATES.join(', ')}.`
      )
    }
    const result = await client.call<RuntimeWorktreePsResult>('worktree.ps', {})
    const chats = listChatSessions(result.result.worktrees).filter(
      (chat) => !state || chat.state === state
    )
    printResult({ ...result, result: { chats } }, json, formatChatList)
  },
  'chat read': async ({ flags, client, json }) => {
    const session = readSession(flags)
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit') ?? DEFAULT_READ_LIMIT
    if (limit > MAX_READ_LIMIT) {
      throw new RuntimeClientError('invalid_argument', `--limit must be at most ${MAX_READ_LIMIT}.`)
    }
    // Status frames and turn markers share the journal, so read the most rows a page allows.
    const response = await readHistory(client, session, AGENT_SESSION_HISTORY_MAX_LIMIT, 'read')
    const { page } = response.result
    const all = chatTranscript(page.items, page.actionablePromptIds)
    const entries = all.slice(-limit)
    printResult(
      {
        ...response,
        // truncated: older rows exist past the 200-row read and fewer entries than --limit came back.
        result: { session, entries, truncated: page.hasOlder && all.length < limit }
      },
      json,
      formatChatRead
    )
  },
  'chat send': async ({ flags, client, cwd, json }) => {
    const session = readSession(flags)
    const text = (await readTextOrFileFlag(flags, cwd, 'text', true)) ?? ''
    if (text.trim().length === 0) {
      throw new RuntimeClientError('invalid_argument', 'The message must not be empty.')
    }
    const status = await client.getCliStatus()
    if (!status.result.runtime.reachable) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'Orca could not reach the execution host, so nothing was sent. Retry once it is reachable.'
      )
    }
    // A working chat queues the message until its turn ends, as the app does; older hosts get a plain send.
    const queue =
      status.result.runtime.capabilities?.includes(
        AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY
      ) === true
    // The send is fenced to the runtime read here, so a chat that restarted since refuses it.
    const history = (await readHistory(client, session, 1, 'send to')).result
    const fence = history.ok ? history.page.fence : (history.fence ?? history.page.fence)
    if (fence === undefined) {
      throw new RuntimeClientError(
        'agent_session_not_running',
        `Chat ${session} has no running session on this host, so nothing was sent. Open it in Orca and retry.`
      )
    }
    const result = await client
      .call<AgentSessionMutationResult<AgentSessionSendResult>>(
        'agentSession.send',
        structuredAgentSessionMessageSendMutation({
          sessionId: session,
          clientOperationId: createStructuredAgentSessionOperationId(randomUUID),
          expectedRuntimeFence: fence,
          body: structuredAgentSessionSendBody(text, []),
          ...(queue ? { delivery: 'queue-if-active' as const } : {})
        })
      )
      .catch((error: unknown) => {
        throw explainChatRefusal(error, session, 'send to')
      })
    if (!result.result.ok) {
      const { code, message } = result.result.refusal
      throw explainChatRefusal(new RuntimeClientError(code, message), session, 'send to')
    }
    const value = result.result.value
    const sent = {
      session,
      delivery: 'queued' in value ? ('queued' as const) : ('submitted' as const),
      clientMessageId: value.clientMessageId,
      ...('queued' in value ? { queuePosition: value.queued.position } : {})
    }
    printResult({ ...result, result: sent }, json, (r) =>
      r.delivery === 'queued'
        ? `Queued for ${r.session}; it is sent when the current turn ends.`
        : `Sent to ${r.session}.`
    )
  }
}

// The host answers with bare wire codes; say what they mean for this command.
function explainChatRefusal(error: unknown, sessionId: string, action: string): unknown {
  if (!(error instanceof RuntimeClientError)) {
    return error
  }
  if (error.message === 'agent_session_identity_required') {
    return new RuntimeClientError(
      'agent_session_identity_required',
      `No chat with session id ${sessionId} on this host.`
    )
  }
  if (isUnattachedAgentSessionReadRefusal(error)) {
    return new RuntimeClientError(
      AGENT_SESSION_UNATTACHED_REFUSAL_CODE,
      `No open chat with session id ${sessionId} on this host. Find it with \`orca chat list\`.`
    )
  }
  if (
    error.message === 'structured_agent_session_unsupported' ||
    error.code === 'method_not_found'
  ) {
    return new RuntimeClientError(
      'incompatible_runtime',
      `This Orca host cannot ${action} chats from the CLI. Update Orca on that host, or check that it has chats turned on.`
    )
  }
  return error
}
