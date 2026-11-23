import { getAgentLabel } from '@/lib/agent-catalog/agent-catalog'
import { translate } from '@/i18n/i18n'
import { APP_PROFILE_PATH_ROOT, appProfileDir } from '@/lib/app-profile-path-display'
import { isLocalExecutionHost } from '../../../../shared/execution-host/execution-host'
import type { TerminalAgent } from '../../../../shared/agent-status/identity/terminal-agent'
import { UNSAVED_DRAFTS_REMOVAL_REFUSAL } from '../../../../shared/worktree/removal/removal'

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

export function botErrorMessage(error: unknown): string {
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
  return translate('bots.errors.generic', 'Something went wrong. Try again.')
}
