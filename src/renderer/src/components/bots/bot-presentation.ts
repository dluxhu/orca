import { botFailureText, readBotFailure } from '../../../../shared/bots/bot-failure-copy'
import { getAgentLabel } from '@/lib/agent-catalog/agent-catalog'
import { translate } from '@/i18n/i18n'
import {
  APP_PROFILE_PATH_ROOT,
  appProfileDir,
  localOrcaHomeDir
} from '@/lib/app-profile-path-display'
import { isLocalExecutionHost } from '../../../../shared/execution-host/execution-host'
import type { TerminalAgent } from '../../../../shared/agent-status/identity/terminal-agent'
import { UNSAVED_DRAFTS_REMOVAL_REFUSAL } from '../../../../shared/worktree/removal/removal'
import {
  agentSessionRefusalFailure,
  readAgentSessionErrorRefusal
} from '../../../../shared/agent-session/failures/agent-session-write-failure'
import { agentSessionStartRefusalParts } from '../../../../shared/agent-session/failures/agent-session-refusal-notice'
import { agentSessionWriteNoticeText } from '@/components/native-chat/messages/notices/agent-session-write-notice-text'
import { structuredAgentSessionTargetPlace } from '@/components/native-chat/pane/ownership/use-structured-agent-session-host-label'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { useAppStore } from '@/store'
import type { AgentSessionRefusalReference } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'

/** Bots name their agent as the product does ("Claude Code"); the shared catalog's "Claude" stays app-wide. */
export function botAgentLabel(agent: TerminalAgent): string {
  return agent === 'claude'
    ? translate('bots.new.agentClaude', 'Claude Code')
    : getAgentLabel(agent)
}

const IS_WINDOWS = navigator.userAgent.includes('Windows')

/** A bot's home, shown from the user's home, or from the app profile's folder, not as a full path. */
export function botFolderDisplay(
  folder: string,
  hostId: string,
  windows = IS_WINDOWS,
  profileDir = appProfileDir()
): string {
  if (profileDir && isLocalExecutionHost(hostId)) {
    return `${APP_PROFILE_PATH_ROOT}/bots/${folder}`
  }
  return windows ? `%USERPROFILE%\\.orca\\bots\\${folder}` : `~/.orca/bots/${folder}`
}

/** A bot's home on this computer, or null where this window cannot open local files. */
export function localBotFolderPath(
  folder: string,
  windows = IS_WINDOWS,
  profileDir = appProfileDir(),
  orcaHome = localOrcaHomeDir()
): string | null {
  // shortcut: an isolated data folder (dev runs) keeps bots in <userData>/bots. There the link
  // opens ~/.orca/bots. When that is a problem, get the bots folder from main.
  return orcaHome ? [profileDir ?? orcaHome, 'bots', folder].join(windows ? '\\' : '/') : null
}

/** A bot chat its agent refused, as native chat words it. Its host calls itself this computer, so
 *  `hostName` names the runtime the bot runs on as this reader does. */
export function botRefusalText(refusal: AgentSessionRefusalReference, hostName?: string): string {
  return agentSessionWriteNoticeText(
    agentSessionStartRefusalParts(agentSessionRefusalFailure(refusal), hostName ? { hostName } : {})
  )
}

/** A bot failure the host sent by code, in this reader's language; null when it sent none. */
export function botFailureMessage(error: unknown): string | null {
  const data = error instanceof RuntimeRpcCallError ? error.response.error.data : undefined
  const failure = readBotFailure(
    typeof data === 'object' && data !== null && 'botFailure' in data ? data.botFailure : undefined
  )
  return failure ? botFailureText(failure, translate) : null
}

/** The host's own words for a refusal, translated when it sent a code. */
export function botErrorText(error: unknown): string {
  return botFailureMessage(error) ?? (error instanceof Error ? error.message : String(error))
}

export function botErrorMessage(error: unknown): string {
  const coded = botFailureMessage(error)
  if (coded) {
    return coded
  }
  // Runtime errors carry the controller's code as their message.
  if (error instanceof Error && error.message === 'bot_name_taken') {
    return translate('bots.errors.nameTaken', 'Another bot already has that name.')
  }
  if (error instanceof Error && error.message === 'bot_avatar_invalid') {
    return translate(
      'bots.errors.avatarInvalid',
      'That picture could not be used. Pick a PNG or JPG image.'
    )
  }
  if (error instanceof Error && error.message === UNSAVED_DRAFTS_REMOVAL_REFUSAL) {
    return translate(
      'bots.errors.unsavedDrafts',
      'Its folder has unsaved editor changes. Save or close them, then delete again.'
    )
  }
  const refusal = readAgentSessionErrorRefusal(error)
  if (refusal) {
    const host = error instanceof RuntimeRpcCallError ? error.target : undefined
    return botRefusalText(
      refusal,
      host && structuredAgentSessionTargetPlace(useAppStore.getState(), host, translate)
    )
  }
  return translate('bots.errors.generic', 'Something went wrong. Try again.')
}
