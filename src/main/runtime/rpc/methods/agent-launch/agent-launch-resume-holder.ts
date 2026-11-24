import type { RpcContext } from '../../core'
import type { AgentLaunchStructuredSurface } from '../../../../agent-launch/agent-launch-surface-factories'
import type { AgentSessionWireRefusal } from '../../../../../shared/agent-session/failures/agent-session-wire-refusals'
import type { StructuredAgentId } from '../../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import { getStructuredAgentSessionHost } from '../../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

/** A resume whose conversation a chat without a live owner holds opens that chat, so one chat
 *  holds each conversation. A live owner, another workspace or another agent keeps the refusal. */
export async function openReleasedHolder(
  context: RpcContext,
  refusal: AgentSessionWireRefusal,
  launch: {
    /** The create proved it changed nothing. */
    beforeCommit: boolean
    worktreeId: string
    agent: StructuredAgentId
    remoteControl?: true
    activate: boolean
  }
): Promise<AgentLaunchStructuredSurface | null> {
  const owner =
    refusal.code === 'agent_session_ownership_unknown' &&
    refusal.details?.reason === 'conversationHeldElsewhere'
      ? refusal.details.owner
      : undefined
  const host = getStructuredAgentSessionHost()
  if (
    !owner ||
    !host ||
    !launch.beforeCommit ||
    owner.workspaceId !== launch.worktreeId ||
    host.sessionAgent(owner.sessionId) !== launch.agent
  ) {
    return null
  }
  if (launch.remoteControl) {
    host.deps.adapter.turnOnRemoteControlAtOpen?.({
      sessionId: owner.sessionId,
      agent: launch.agent
    })
  }
  const revealed = await host.revealSession(owner.sessionId)
  await context.runtime.publishStructuredAgentSessionTab({
    workspaceId: revealed.workspaceId,
    sessionId: revealed.sessionId,
    agent: revealed.agent,
    activate: launch.activate
  })
  return {
    sessionId: revealed.sessionId,
    handle: structuredAgentSessionTabId(revealed.sessionId),
    fence: host.deps.store.getRecord(revealed.sessionId)?.lease.runtimeFence ?? 0
  }
}
