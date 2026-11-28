import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { useAppStore } from '@/store'
import { LocalWebhooksSettings } from './LocalWebhooksSettings'

const settings = getDefaultSettings('/Users/test')

function Setting(): React.JSX.Element {
  const current = useAppStore((state) => state.settings) ?? settings
  return (
    <LocalWebhooksSettings
      settings={current}
      hostScope={{ target: { kind: 'local' }, available: true }}
    />
  )
}

function mockInterfaces(): void {
  Object.assign(window.api, {
    mobile: {
      ...window.api.mobile,
      listNetworkInterfaces: async () => ({
        interfaces: [
          { name: 'en0', address: '192.168.1.20' },
          { name: 'wt0', address: '100.92.14.7' }
        ]
      })
    }
  })
}

export const off = defineFixture({
  width: 720,
  store: { settings },
  render: () => <Setting />
})

export const on = defineFixture({
  width: 720,
  store: {
    settings: {
      ...settings,
      localWebhooksEnabled: true,
      localWebhooksBindAddress: '100.92.14.7',
      localWebhooksPort: 6790
    }
  },
  setup: mockInterfaces,
  render: () => <Setting />
})

export const withPublicUrl = defineFixture({
  width: 720,
  store: {
    settings: {
      ...settings,
      localWebhooksEnabled: true,
      localWebhooksBindAddress: '100.92.14.7',
      localWebhooksPort: 6790,
      localWebhooksPublicUrl: 'https://hooks.example.net'
    }
  },
  setup: mockInterfaces,
  render: () => <Setting />
})
