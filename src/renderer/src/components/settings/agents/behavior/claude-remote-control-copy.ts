import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import { searchKeywords } from '../../search/settings-search-keywords'

export function getClaudeRemoteControlTitle(t: Translate = translate): string {
  return t(
    'components.settings.agents.claudeRemoteControl.title',
    'Remote Control for new Claude chats'
  )
}

export function getClaudeRemoteControlDescription(t: Translate = translate): string {
  return t(
    'components.settings.agents.claudeRemoteControl.description',
    'Connect each new Claude chat to claude.ai and the Claude app, so you can follow and answer it from there.'
  )
}

export function getClaudeRemoteControlSearchKeywords(): string[] {
  return searchKeywords([
    {
      key: 'auto.components.settings.agents.search.f412abbba5',
      fallback: 'claude',
      englishOnly: true
    },
    { key: 'components.settings.agents.claudeRemoteControl.search.remote', fallback: 'remote' },
    { key: 'components.settings.agents.claudeRemoteControl.search.phone', fallback: 'phone' },
    { key: 'components.settings.agents.claudeRemoteControl.search.mobile', fallback: 'mobile' }
  ])
}
