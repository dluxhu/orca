import { useEffect, useState } from 'react'
import { ExternalLink, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { structuredAgentSessionTargetForTab } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import type { AgentSessionRemoteControlState } from '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-remote-control-params'

type RemoteControlPane = { tabId: string; worktreeId: string; sessionId: string }

function remoteControl(
  pane: RemoteControlPane,
  enabled?: boolean
): Promise<AgentSessionRemoteControlState | null> {
  const state = useAppStore.getState()
  const tab = state.unifiedTabsByWorktree[pane.worktreeId]?.find(
    (candidate) => candidate.id === pane.tabId
  )
  const target = tab ? structuredAgentSessionTargetForTab(state, tab) : null
  return target
    ? callRuntimeRpc<AgentSessionRemoteControlState | null>(target, 'agentSession.remoteControl', {
        sessionId: pane.sessionId,
        ...(enabled === undefined ? {} : { enabled })
      })
    : Promise.resolve(null)
}

/** Shown only for a running Claude chat; the host answers null for every other chat. */
export function NativeChatRemoteControlMenuItems({
  pane
}: {
  pane: RemoteControlPane
}): React.JSX.Element | null {
  const t = useTranslate()
  const [state, setState] = useState<AgentSessionRemoteControlState | null>(null)
  const { tabId, worktreeId, sessionId } = pane
  useEffect(() => {
    let current = true
    // An older host has no such method; the items then stay hidden.
    remoteControl({ tabId, worktreeId, sessionId }).then(
      (next) => current && setState(next),
      () => {}
    )
    return () => {
      current = false
    }
  }, [tabId, worktreeId, sessionId])
  if (!state) {
    return null
  }
  const toggle = async (): Promise<void> => {
    try {
      const next = await remoteControl(pane, !state.enabled)
      if (next?.enabled) {
        toast.success(
          t('components.native-chat.remoteControl.on', 'Remote Control is on'),
          next.sessionUrl ? { description: next.sessionUrl } : undefined
        )
      }
    } catch {
      toast.error(
        t('components.native-chat.remoteControl.failed', "Couldn't change Remote Control")
      )
    }
  }
  const sessionUrl = state.sessionUrl
  return (
    <>
      <DropdownMenuItem onSelect={() => void toggle()}>
        <Smartphone />
        {state.enabled
          ? t('components.native-chat.remoteControl.turnOff', 'Turn Off Remote Control')
          : t('components.native-chat.remoteControl.turnOn', 'Turn On Remote Control')}
      </DropdownMenuItem>
      {sessionUrl ? (
        <DropdownMenuItem onSelect={() => void window.api.shell.openUrl(sessionUrl)}>
          <ExternalLink />
          {t('components.native-chat.remoteControl.open', 'Open in Claude')}
        </DropdownMenuItem>
      ) : null}
    </>
  )
}
