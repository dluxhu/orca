import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../search/settings-search-keywords'

export const getAutomationsSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.automations.d92f253d2d', 'Show automations button'),
    description: translate(
      'auto.components.settings.automations.showButtonDescription',
      'Show the Automations shortcut in the sidebar.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.automations.keywordAutomations',
        'automations'
      ),
      ...translateSearchKeyword('auto.components.settings.automations.keywordSchedule', 'schedule'),
      ...translateSearchKeyword('auto.components.settings.automations.keywordAgent', 'agent'),
      ...translateSearchKeyword('auto.components.settings.automations.keywordRuns', 'runs')
    ]
  },
  {
    title: translate('components.settings.localWebhooks.title', 'Local webhooks'),
    description: translate(
      'components.settings.localWebhooks.searchDescription',
      'Take webhook calls on a port of this computer, without an Orca account.'
    ),
    keywords: [
      ...translateSearchKeyword('components.settings.localWebhooks.keywordWebhook', 'webhook'),
      ...translateSearchKeyword('components.settings.localWebhooks.keywordPort', 'port'),
      ...translateSearchKeyword('components.settings.localWebhooks.keywordNetbird', 'netbird'),
      ...translateSearchKeyword('components.settings.localWebhooks.keywordTailscale', 'tailscale')
    ]
  }
])
