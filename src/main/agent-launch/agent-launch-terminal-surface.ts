import type { AgentLaunchSurfaceExecution } from './agent-launch-execution'
import type { CreatedSurface } from './agent-launch-executor'
import { argvLaunchPrompt } from './agent-launch-prompt-delivery'
import { assertResumeOpensChat, terminalLaunchInputs } from './agent-launch-surface-factories'

export async function createTerminalSurface(
  execution: AgentLaunchSurfaceExecution,
  workspace: { worktreeId: string; connectionId?: string | null }
): Promise<CreatedSurface> {
  const { intent, surfaces } = execution
  assertResumeOpensChat(intent, 'terminal')
  const startupPrompt = argvLaunchPrompt(intent)
  const terminal = await surfaces.createTerminalAgent({
    worktreeId: workspace.worktreeId,
    agent: intent.agent,
    ...(startupPrompt ? { startupPrompt } : {}),
    ...terminalLaunchInputs(intent),
    viewMode: 'terminal'
  })
  return {
    outcome: {
      kind: 'terminal',
      handle: terminal.handle,
      ...(terminal.paneKey ? { paneKey: terminal.paneKey } : {})
    },
    terminalCreation: terminal.terminalCreation,
    ...(terminal.warning ? { warning: terminal.warning } : {}),
    ...(startupPrompt && terminal.promptRodeLaunchCommand ? { promptRodeLaunchCommand: true } : {})
  }
}
