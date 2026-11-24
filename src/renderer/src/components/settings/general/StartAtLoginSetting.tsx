// "Start at login" and "Port" of this app's own profile. See docs/fork/profiles-design.md, section 4.
import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  appPortWarning,
  appProfilePortError,
  defaultAppPortError,
  type AppProfileReply,
  type OwnAppProfile
} from '../../../../../shared/app-profiles/app-profile-rules'
import { PortChangeConfirm } from '../../profile-manager/PortChangeConfirm'
import { NumberField, SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { matchesSettingsSearch } from '../search/settings-search'

export function StartAtLoginSetting({ query }: { query: string }): React.JSX.Element | null {
  const t = useTranslate()
  const api = window.api.appProfiles
  const [own, setOwn] = useState<OwnAppProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [portError, setPortError] = useState<string | null>(null)
  /** The port that waits for the confirm dialog. */
  const [newPort, setNewPort] = useState<number | null>(null)
  // A new key puts the typed text of the port field back to the saved port.
  const [portKey, setPortKey] = useState(0)

  useEffect(() => {
    void api
      ?.getOwnProfile()
      .then(setOwn)
      .catch(() => setOwn(null))
  }, [api])

  const label = t('settings.general.startAtLogin.label', 'Start at login')
  const description = t(
    'settings.general.startAtLogin.description',
    "Runs this profile's server from login, also when Orca is closed, so your other devices can connect."
  )
  const portLabel = t('settings.general.profilePort.label', 'Port')
  const portDescription = t(
    'settings.general.profilePort.description',
    "The saved port of this profile's server. The server uses it at its next start."
  )
  if (
    !api ||
    own === null ||
    !matchesSettingsSearch(query, [
      { title: label, description },
      { title: portLabel, description: portDescription }
    ])
  ) {
    return null
  }

  /** Runs one change, then reads the profile again: the state comes from the CLI, not the input. */
  const apply = (
    send: () => Promise<AppProfileReply>,
    onError: (message: string) => void
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    setPortError(null)
    const set = async (): Promise<void> => {
      const reply = await send()
      if (!reply.ok) {
        onError(reply.error.message)
      }
    }
    // Promise.finally: React Compiler cannot compile a try/finally statement.
    return set().finally(async () => {
      setOwn(await api.getOwnProfile())
      setPortKey((key) => key + 1)
      setBusy(false)
    })
  }

  const portReadOnly = own.serverRuns
    ? t('settings.general.profilePort.serverRuns', "Stop this profile's server to change its port.")
    : null
  const ruleError = (port: number): string | null =>
    own.id === 'default'
      ? defaultAppPortError(port, own.otherPorts, t)
      : appProfilePortError(port, own.otherPorts, t, own.defaultPort)
  // A hand edit of profiles.json can give two profiles one port.
  const shownPortError = portError ?? ruleError(own.port)
  // Both ways: a profile is near the default app's port, the default app near a profile's.
  const warning = (port: number): string | null =>
    appPortWarning(port, own.id === 'default' ? own.otherPorts : [own.defaultPort], t)
  const shownWarning = shownPortError ? null : warning(own.port)

  const askPort = (port: number): void => {
    const rule = ruleError(port)
    if (rule) {
      setPortError(rule)
      setPortKey((key) => key + 1)
      return
    }
    setPortError(null)
    setNewPort(port)
  }

  const cancelPort = (): void => {
    setNewPort(null)
    setPortKey((key) => key + 1)
  }

  return (
    <SettingsGroup>
      <SettingsSwitchRow
        label={label}
        description={description}
        checked={own.enabled}
        disabled={busy}
        onChange={() => void apply(() => api.setOwnStartAtLogin(!own.enabled), setError)}
      />
      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {t('settings.general.startAtLogin.error', 'Start at login did not change: {{message}}', {
            message: error
          })}
        </p>
      ) : null}
      <NumberField
        key={portKey}
        label={portLabel}
        description={portReadOnly ?? portDescription}
        value={own.port}
        min={1024}
        max={65535}
        integer
        disabled={busy || portReadOnly !== null}
        disabledReason={portReadOnly ?? undefined}
        onChange={askPort}
      />
      {shownPortError ? (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {shownPortError}
        </p>
      ) : null}
      {shownWarning ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">{shownWarning}</p>
      ) : null}
      <PortChangeConfirm
        port={newPort}
        warning={newPort === null ? null : warning(newPort)}
        busy={busy}
        onCancel={cancelPort}
        onConfirm={(port) => {
          setNewPort(null)
          void apply(
            () => api.setOwnPort(port),
            (message) =>
              setPortError(
                t('settings.general.profilePort.error', 'The port did not change: {{message}}', {
                  message
                })
              )
          )
        }}
      />
    </SettingsGroup>
  )
}
