// Settings > Appearance > App icon on macOS: the same chooser as the Profile Manager.
import { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { AppIconId } from '../../../../../shared/app-lifecycle/identity/app-icon'
import type { OwnAppProfile } from '../../../../../shared/app-profiles/app-profile-rules'
import { fixturePreview } from '../../../component-fixtures/fixture-icon-preview'
import { AppIconSetting } from './AppearanceIconChooser'

const own: OwnAppProfile = {
  id: 'default',
  enabled: false,
  port: 6768,
  otherPorts: [],
  defaultPort: 6768,
  serverRuns: false,
  userDataPath: '/data/default',
  icon: { kind: 'badge', text: 'D', style: 'sticker', color: '#dc2626' }
}

function Setting(props: { first: AppIconId }): React.JSX.Element {
  const [value, setValue] = useState(props.first)
  return (
    <div className="p-6">
      <AppIconSetting value={value} onChange={setValue} />
    </div>
  )
}

const stub = (profile: OwnAppProfile) => (): void => {
  Object.assign(window.api, {
    appProfiles: {
      ...window.api.appProfiles,
      getOwnProfile: async () => profile,
      ownIconPreview: fixturePreview,
      chooseOwnIconFile: async () => '/Users/me/base.png',
      setOwnIcon: async () => ({ ok: true, result: {} })
    }
  })
}

export const defaultAppWithBadge = defineFixture({
  width: 860,
  setup: stub(own),
  render: () => <Setting first="classic" />
})

export const profileWithoutBadge = defineFixture({
  width: 860,
  setup: stub({ ...own, id: 'work', icon: { kind: 'none', base: 'blue' } }),
  render: () => <Setting first="classic" />
})
