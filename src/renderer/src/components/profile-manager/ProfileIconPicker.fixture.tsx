// The icon part of the Profile Manager's Edit dialog. The preview is a style thumbnail: a live
// preview takes the CLI.
import { useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import { fixturePreview, waitForPreview } from '../../component-fixtures/fixture-icon-preview'
import { ProfileIconPicker, ProfileIconPreview, type IconChooserApi } from './ProfileIconPicker'

function EditIcon(props: {
  first: AppProfileIconSource
  chooseFile?: IconChooserApi['chooseFile']
}): React.JSX.Element {
  const [value, setValue] = useState(props.first)
  return (
    <div className="flex gap-6 p-6">
      <ProfileIconPicker
        value={value}
        onChange={setValue}
        defaultText="W"
        chooseFile={props.chooseFile ?? (async () => '/Users/me/base.png')}
      />
      <ProfileIconPreview value={value} preview={fixturePreview} />
    </div>
  )
}

export const badgeOnBuiltInBase = defineFixture({
  interact: waitForPreview,
  width: 752,
  render: () => (
    <EditIcon
      first={{ kind: 'badge', text: 'W', style: 'sticker', color: '#2563eb', base: 'blue' }}
    />
  )
})

export const noBadge = defineFixture({
  interact: waitForPreview,
  width: 752,
  render: () => <EditIcon first={{ kind: 'none', base: 'watercolor' }} />
})

export const badgeOnUpload = defineFixture({
  interact: waitForPreview,
  width: 752,
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

// Upstream's custom icon import refuses an upload that is not square.
export const uploadNotSquare = defineFixture({
  interact: async (frame) => {
    ;[...frame.querySelectorAll('button')].find((b) => b.textContent === 'Upload…')?.click()
    await waitForPreview()
  },
  width: 752,
  render: () => (
    <EditIcon
      first={{ kind: 'badge', text: 'W', style: 'sticker', base: 'classic' }}
      chooseFile={async () => ({ code: 'notSquare' })}
    />
  )
})
