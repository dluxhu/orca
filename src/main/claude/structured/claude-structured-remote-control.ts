import type { AgentSessionRemoteControlState } from '../../../shared/rpc-contract/structured-agent-session/structured-agent-session-remote-control-params'
import { ClaudeControlRequestError } from '../sdk-transport/claude-agent-sdk-control-requests'
import { claudeRecord, claudeText } from './journal/claude-structured-item-translation'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './claude-structured-session-state'

/** The user's own `remoteControlAtStartup`; an org or rollout default alone asks for a notice Orca does not show. */
export function claudeRemoteControlAutoEnable(initialization: unknown): boolean {
  const reply = claudeRecord(initialization)
  return (
    reply?.remote_control_auto_enable === true && reply.remote_control_auto_on_by_default !== true
  )
}

/** A bridge the CLI reports failed is off: never show a stale "on". */
export function observeClaudeBridgeState(
  session: ClaudeSession,
  message: Record<string, unknown>
): void {
  if (
    message.type === 'system' &&
    message.subtype === 'bridge_state' &&
    (message.state === 'failed' || message.state === 'policy_disabled')
  ) {
    delete session.remoteControl
  }
}

// shortcut: remembers only the last 256 replay uuids, so an older re-echo shows again; keep more if the CLI re-echoes older prompts.
const REMEMBERED_REPLAY_UUIDS = 256

/** Replays a send settled or a prompt row showed, so a repeated echo adds no second prompt row. */
export function rememberClaudeReplayUuid(session: ClaudeSession, uuid: string): void {
  const seen = (session.seenReplayUuids ??= new Set())
  seen.add(uuid)
  const [oldest] = seen
  if (seen.size > REMEMBERED_REPLAY_UUIDS && oldest !== undefined) {
    seen.delete(oldest)
  }
}

/** An echo of a prompt sent through Remote Control, not one Orca sent or the CLI wrote itself. */
export function isClaudeRemotePrompt(
  session: ClaudeSession,
  message: Record<string, unknown>
): boolean {
  const origin = claudeRecord(message.origin)?.kind
  return (
    session.remoteControl !== undefined &&
    message.isReplay === true &&
    origin !== 'peer' &&
    origin !== 'channel' &&
    typeof message.uuid === 'string' &&
    session.seenReplayUuids?.has(message.uuid) !== true
  )
}

/**
 * Remote Control per chat. The user's latest choice is recorded before any request goes out; a CLI
 * answer only confirms its own request, and only while that request is the session's latest.
 */
export class ClaudeRemoteControl {
  /** What each chat should be, across its process restarts until the app quits. */
  private readonly intents = new Map<string, boolean>()
  /** The bridge session to reattach to on the next Turn On or restart. */
  private readonly bridges = new Map<string, string>()
  private readonly latest = new WeakMap<ClaudeSession, number>()
  private requests = 0

  constructor(
    private readonly sessions: ReadonlyMap<string, ClaudeSession>,
    private readonly deps: Pick<
      ClaudeStructuredSessionAdapterDeps,
      'requestTimeoutMs' | 'logger' | 'remoteControlForNewChats'
    >
  ) {}

  state(sessionId: string): AgentSessionRemoteControlState | null {
    const session = this.sessions.get(sessionId)
    if (!session?.connection.setRemoteControl) {
      return null
    }
    return {
      enabled: session.remoteControl !== undefined,
      sessionUrl: session.remoteControl?.sessionUrl ?? null
    }
  }

  async set(sessionId: string, enabled: boolean): Promise<AgentSessionRemoteControlState | null> {
    this.intents.set(sessionId, enabled)
    if (!enabled) {
      this.bridges.delete(sessionId)
    }
    const session = this.sessions.get(sessionId)
    if (session) {
      await this.request(session, sessionId, enabled)
    }
    return this.state(sessionId)
  }

  opened(
    session: ClaudeSession,
    sessionId: string,
    initialization: unknown,
    newConversation: boolean
  ): void {
    // A choice made in this chat outranks the setting and the CLI's auto-connect.
    const on =
      this.intents.get(sessionId) ??
      ((newConversation && this.deps.remoteControlForNewChats?.() === true) ||
        claudeRemoteControlAutoEnable(initialization))
    if (!on) {
      return
    }
    this.intents.set(sessionId, true)
    // The chat works without Remote Control; a refusal only leaves it off.
    void this.request(session, sessionId, true).catch((error: unknown) => {
      if (!session.connection.closed) {
        this.deps.logger?.warn('turning on Claude Remote Control failed', {
          scope: 'claude-remote-control',
          sessionId,
          error
        })
      }
    })
  }

  private async request(
    session: ClaudeSession,
    sessionId: string,
    enabled: boolean
  ): Promise<void> {
    const set = session.connection.setRemoteControl
    if (!set) {
      throw new ClaudeControlRequestError('remote_control', 'this SDK exposes no remote_control')
    }
    const request = ++this.requests
    this.latest.set(session, request)
    const current = (): boolean =>
      this.latest.get(session) === request && this.sessions.get(sessionId) === session
    const reattachSessionId = enabled ? this.bridges.get(sessionId) : undefined
    let reply: Record<string, unknown> | null
    try {
      reply = claudeRecord(
        await set(enabled, {
          ...(this.deps.requestTimeoutMs === undefined
            ? {}
            : { timeoutMs: this.deps.requestTimeoutMs }),
          ...(reattachSessionId ? { reattachSessionId } : {})
        })
      )
    } catch (error) {
      // A newer choice owns the state; this failure no longer concerns the user.
      if (!current()) {
        return
      }
      delete session.remoteControl
      throw error
    }
    if (!current()) {
      return
    }
    if (!enabled) {
      delete session.remoteControl
      return
    }
    session.remoteControl = { sessionUrl: claudeText(reply?.session_url) }
    const bridge = claudeText(reply?.bridge_session_id)
    if (bridge) {
      this.bridges.set(sessionId, bridge)
    }
  }
}
