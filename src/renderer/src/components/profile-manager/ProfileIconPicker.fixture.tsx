// The icon part of the Profile Manager's Edit dialog. The preview is a style thumbnail: a live
// preview takes the CLI.
import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import { fixturePreview } from '../../component-fixtures/fixture-icon-preview'
import { ProfileIconPicker, ProfileIconPreview } from './ProfileIconPicker'

function EditIcon(props: { first: AppProfileIconSource }): React.JSX.Element {
  const [value, setValue] = useState(props.first)
  return (
    <div className="flex flex-wrap gap-8 p-6">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col">
        <ProfileIconPicker
          value={value}
          onChange={setValue}
          defaultText="W"
          chooseFile={async () => '/Users/me/base.png'}
        />
      </div>
      <ProfileIconPreview value={value} preview={fixturePreview} />
    </div>
  )
}

export const badgeOnBuiltInBase = defineFixture({
  width: 980,
  render: () => (
    <EditIcon
      first={{ kind: 'badge', text: 'W', style: 'sticker', color: '#2563eb', base: 'blue' }}
    />
  )
})

export const noBadge = defineFixture({
  width: 980,
  render: () => <EditIcon first={{ kind: 'none', base: 'watercolor' }} />
})

export const badgeOnUpload = defineFixture({
  width: 980,
  render: () => (
    <EditIcon
      first={{
        kind: 'image',
        path: '/Users/me/logo.svg',
        style: 'ref-match',
        base: '/Users/me/base.png'
      }}
    />
  )
})
