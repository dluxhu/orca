import { z } from 'zod'
import { OptionsParams } from './structured-agent-session-params'

/** Without `enabled`, the call only reads the chat's state. */
export const RemoteControlParams = OptionsParams.extend({
  enabled: z.boolean().optional()
}).strict()

/** A running Claude chat's Remote Control; `agentSession.remoteControl` answers null for other chats. */
export type AgentSessionRemoteControlState = { enabled: boolean; sessionUrl: string | null }
