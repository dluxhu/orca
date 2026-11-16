// `agentSession.remoteControl`: read, or turn on or off, Claude Remote Control for a running chat.

import { defineMethod } from '../../../core'
import { requireStructuredSessionHost as requireSessionHost } from '../creation/structured-agent-session-gate'
import { RemoteControlParams } from '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-remote-control-params'

export const STRUCTURED_AGENT_SESSION_REMOTE_CONTROL_METHODS = [
  defineMethod({
    name: 'agentSession.remoteControl',
    permission: 'workspace',
    params: RemoteControlParams,
    handler: async ({ sessionId, enabled }, ctx) =>
      (await requireSessionHost(ctx, sessionId).deps.adapter.remoteControl?.({
        sessionId,
        ...(enabled === undefined ? {} : { enabled })
      })) ?? null
  })
]
