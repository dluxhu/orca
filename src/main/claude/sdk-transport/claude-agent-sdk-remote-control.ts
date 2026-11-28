import type { Query } from '@anthropic-ai/claude-agent-sdk'

// shortcut: sdk.d.ts (0.3.319) omits Query.enableRemoteControl, so its runtime signature is typed here; drop it once the SDK declares it.
type ClaudeEnableRemoteControl = (
  enabled: boolean,
  name?: string,
  options?: { reattachSessionId?: string }
) => Promise<unknown>

/** The query's Remote Control call, or null when this CLI has none. */
export function claudeQueryRemoteControl(query: Query): ClaudeEnableRemoteControl | null {
  const enable = 'enableRemoteControl' in query ? query.enableRemoteControl : null
  return typeof enable === 'function'
    ? (...args) => Promise.resolve(enable.apply(query, args))
    : null
}
