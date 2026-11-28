// Fork patch: Settings > Appearance uses the icon chooser of the Profile Manager, for this app's
// own icon. See docs/fork/profiles-design.md, section 8.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { getRendererAppPlatform } from '@/app-shell/platform/renderer-app-platform'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import {
  isBuiltInIconBase,
  nextBadgeText,
  type AppProfileIconSource,
  type OwnAppProfile
} from '../../../../../shared/app-profiles/app-profile-rules'
import {
  normalizeAppIconId,
  type AppIconId
} from '../../../../../shared/app-lifecycle/identity/app-icon'
import {
  editIcon,
  iconChoiceReady,
  ProfileIconPicker,
  ProfileIconPreview
} from '../../profile-manager/ProfileIconPicker'
import { AppIconSelector } from './AppIconSelector'

/**
 * The saved choice: the kept icon of the profile (or of the default app), else the appIcon
 * setting with no badge, as upstream has it.
 */
export function savedAppIcon(own: OwnAppProfile, appIcon: AppIconId): AppProfileIconSource {
  if (own.icon) {
    return editIcon(own.icon, nextBadgeText([]), own.userDataPath)
  }
  if (appIcon === 'custom') {
    return own.customIconPath
      ? { kind: 'file', path: own.customIconPath }
      : { kind: 'none', base: 'classic' }
  }
  return { kind: 'none', base: appIcon }
}

/**
 * The appIcon setting that goes with a choice. The default app with no badge on a built-in base
 * keeps upstream's setting alone; every other choice is a kept icon, which `classic` shows.
 */
export function appIconSettingOf(own: OwnAppProfile, icon: AppProfileIconSource): AppIconId {
  return own.id === 'default' && icon.kind === 'none' && isBuiltInIconBase(icon.base)
    ? icon.base
    : 'classic'
}

/** The own-icon calls of the profile API. */
type OwnIconApi = Pick<
  NonNullable<typeof window.api.appProfiles>,
  'setOwnIcon' | 'ownIconPreview' | 'chooseOwnIconFile'
>

export function AppearanceIconChooser(props: {
  api: OwnIconApi
  own: OwnAppProfile
  appIcon: unknown
  /** Saves the appIcon setting. */
  onAppIconChange: (appIcon: AppIconId) => void
  /** Reads the own profile again after a change. */
  onSaved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { api } = props
  const saved = savedAppIcon(props.own, normalizeAppIconId(props.appIcon))
  const savedKey = JSON.stringify(saved)
  const [value, setValue] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A new saved icon (this app's Apply, or the Profile Manager) replaces the choice.
  useEffect(() => setValue(JSON.parse(savedKey) as AppProfileIconSource), [savedKey])

  const changed = JSON.stringify(value) !== savedKey
  const apply = (): void => {
    setBusy(true)
    setError(null)
    const appIcon = appIconSettingOf(props.own, value)
    void api
      .setOwnIcon(value, appIcon)
      .then((reply) => {
        if (!reply.ok) {
          setError(reply.error.message)
          return
        }
        props.onAppIconChange(appIcon)
        props.onSaved()
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught))
      )
      .then(() => setBusy(false))
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap gap-8">
        <div className="flex min-w-0 flex-[999_1_420px] flex-col">
          <ProfileIconPicker
            value={value}
            defaultText={nextBadgeText([])}
            onChange={setValue}
            chooseFile={api.chooseOwnIconFile}
          />
        </div>
        <ProfileIconPreview value={value} busy={busy} preview={api.ownIconPreview} />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !changed}
          onClick={() => setValue(saved)}
        >
          {t('profileManager.icon.reset', 'Reset')}
        </Button>
        <Button size="sm" disabled={busy || !changed || !iconChoiceReady(value)} onClick={apply}>
          {busy
            ? t('profileManager.icon.applying', 'Applying…')
            : t('profileManager.icon.apply', 'Apply icon')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The App icon setting: on the macOS desktop app, the icon chooser for this app's own icon; in a
 * web client, on other platforms or without the profile calls, upstream's selector.
 */
export function AppIconSetting(props: {
  value: AppIconId
  onChange: (value: AppIconId) => void
}): React.JSX.Element {
  // Read once: the preview restarts when its function changes.
  const [api] = useState(() => window.api?.appProfiles)
  const available = Boolean(api) && getRendererAppPlatform() === 'darwin' && !isWebClientLocation()
  const [own, setOwn] = useState<OwnAppProfile | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!available) {
      return
    }
    let current = true
    void api
      ?.getOwnProfile()
      .then((next) => current && setOwn(next))
      .catch(() => current && setOwn(null))
    return () => {
      current = false
    }
  }, [api, available, reads])

  if (!available || !api || !own) {
    return <AppIconSelector value={props.value} onChange={props.onChange} />
  }
  return (
    <AppearanceIconChooser
      api={api}
      own={own}
      appIcon={props.value}
      onAppIconChange={props.onChange}
      onSaved={() => setReads((n) => n + 1)}
    />
  )
}
