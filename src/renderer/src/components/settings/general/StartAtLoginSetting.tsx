// "Start at login": this app's own profile's serve service. See docs/fork/profiles-design.md, section 4.
import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { matchesSettingsSearch } from '../search/settings-search'

export function StartAtLoginSetting({ query }: { query: string }): React.JSX.Element | null {
  const t = useTranslate()
  const api = window.api.appProfiles
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      ?.getOwnStartAtLogin()
      .then((own) => setEnabled(own.enabled))
      .catch(() => setEnabled(null))
  }, [api])

  const label = t('settings.general.startAtLogin.label', 'Start at login')
  const description = t(
    'settings.general.startAtLogin.description',
    "Runs this profile's server from login, also when Orca is closed, so your other devices can connect."
  )
  if (!api || enabled === null || !matchesSettingsSearch(query, [{ title: label, description }])) {
    return null
  }

  const change = async (next: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const reply = await api.setOwnStartAtLogin(next)
      if (!reply.ok) {
        setError(reply.error.message)
      }
    } finally {
      setEnabled((await api.getOwnStartAtLogin()).enabled)
      setBusy(false)
    }
  }

  return (
    <SettingsGroup>
      <SettingsSwitchRow
        label={label}
        description={description}
        checked={enabled}
        disabled={busy}
        onChange={() => void change(!enabled)}
      />
      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {t('settings.general.startAtLogin.error', 'Start at login did not change: {{message}}', {
            message: error
          })}
        </p>
      ) : null}
    </SettingsGroup>
  )
}
