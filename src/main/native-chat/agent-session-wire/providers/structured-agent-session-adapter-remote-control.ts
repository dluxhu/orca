// How a provider turns Remote Control on or off for a running chat.

import type { AgentSessionRemoteControlState } from '../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-remote-control-params'
import type { StructuredAgentSessionAdapterPermission } from './structured-agent-session-adapter-permission'
import type { StructuredAgentSessionAdapterStop } from './structured-agent-session-adapter-stop'

export type StructuredAgentSessionAdapterRemoteControl = {
  /** Turn Remote Control on when this new chat opens, as a Turn On does; false when the agent has none.
   *  `forget` drops that choice for a chat whose create was refused. */
  turnOnRemoteControlAtOpen?(input: { sessionId: string; agent: string; forget?: true }): boolean
  /** Read Remote Control without `enabled`, else turn it on or off; null where the live child has none. */
  remoteControl?(input: {
    sessionId: string
    enabled?: boolean
  }): Promise<AgentSessionRemoteControlState | null>
}

/** The adapter's optional controls; here so structured-agent-session-adapter.ts stays under max-lines. */
export type StructuredAgentSessionAdapterControls = StructuredAgentSessionAdapterStop &
  StructuredAgentSessionAdapterPermission &
  StructuredAgentSessionAdapterRemoteControl
