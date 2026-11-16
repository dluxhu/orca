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

const REMEMBERED_REPLAY_UUIDS = 256

/** Replays already shown, so a repeated echo adds no second prompt row; only kept while Remote Control is on. */
export function rememberClaudeReplayUuid(session: ClaudeSession, uuid: string): void {
  const seen = session.remoteControl?.seenReplayUuids
  if (!seen) {
    return
  }
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
    !session.remoteControl.seenReplayUuids.has(message.uuid)
  )
}

/** Remote Control per chat. A chat stays on across its process restarts and reattaches to the same claude.ai session. */
export class ClaudeRemoteControl {
  /** Per chat: the bridge session to reattach while on, or false after the user turned it off. */
  private readonly chats = new Map<string, string | null | false>()
  /** Only the newest request of a process may write its answer. */
  private readonly generations = new WeakMap<ClaudeSession, number>()

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
    const session = this.sessions.get(sessionId)
    if (session) {
      await this.apply(session, sessionId, enabled)
    }
    return this.state(sessionId)
  }

  opened(
    session: ClaudeSession,
    sessionId: string,
    initialization: unknown,
    newConversation: boolean
  ): void {
    const chosen = this.chats.get(sessionId)
    // A Turn Off in this chat outranks the setting and the CLI's auto-connect.
    const on =
      chosen !== false &&
      (chosen !== undefined ||
        (newConversation && this.deps.remoteControlForNewChats?.() === true) ||
        claudeRemoteControlAutoEnable(initialization))
    if (!on) {
      return
    }
    // The chat works without Remote Control; a refusal only leaves it off.
    void this.apply(session, sessionId, true).catch((error: unknown) => {
      if (!session.connection.closed) {
        this.deps.logger?.warn('turning on Claude Remote Control failed', {
          scope: 'claude-remote-control',
          sessionId,
          error
        })
      }
    })
  }

  private async apply(session: ClaudeSession, sessionId: string, enabled: boolean): Promise<void> {
    const set = session.connection.setRemoteControl
    if (!set) {
      throw new ClaudeControlRequestError('remote_control', 'this SDK exposes no remote_control')
    }
    const chosen = this.chats.get(sessionId)
    const reattachSessionId = typeof chosen === 'string' ? chosen : undefined
    const generation = (this.generations.get(session) ?? 0) + 1
    this.generations.set(session, generation)
    const reply = claudeRecord(
      await set(enabled, {
        ...(this.deps.requestTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.deps.requestTimeoutMs }),
        ...(enabled && reattachSessionId ? { reattachSessionId } : {})
      })
    )
    if (this.generations.get(session) !== generation || this.sessions.get(sessionId) !== session) {
      return
    }
    if (!enabled) {
      delete session.remoteControl
      this.chats.set(sessionId, false)
      return
    }
    session.remoteControl = {
      sessionUrl: claudeText(reply?.session_url),
      seenReplayUuids: session.remoteControl?.seenReplayUuids ?? new Set()
    }
    this.chats.set(sessionId, claudeText(reply?.bridge_session_id))
  }
}
