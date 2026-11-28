import type { ClaudeSession, ClaudeSessionExit } from './claude-structured-session-state'
import { claudeHeldSends } from './turns/claude-command-lifecycle'

/** Whether the session still runs the provider process of this acquisition. */
export function claudeHoldsLiveProviderProcess(
  session: ClaudeSession | undefined,
  acquisitionGeneration: string
): boolean {
  return (
    session?.acquisitionGeneration === acquisitionGeneration &&
    session.connection.pid !== undefined &&
    session.connection.exitVerdict.root === 'live'
  )
}

/** The sends that a live or an exited session holds. An exit with a settled error holds none. */
export function claudeHeldSendsOf(
  sessionId: string,
  sessions: ReadonlyMap<string, ClaudeSession>,
  exits: ReadonlyMap<string, ClaudeSessionExit>,
  settledExitErrors: ReadonlyMap<string, Error>
): ReadonlySet<string> | undefined {
  const session = sessions.get(sessionId) ?? exits.get(sessionId)?.session
  const held = session && claudeHeldSends(session)
  return held ?? (settledExitErrors.has(sessionId) ? new Set() : undefined)
}
