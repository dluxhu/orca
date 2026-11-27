import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { Input } from '@/components/ui/input'
import { AddressPicker, type AddressOption } from '../../network/AddressPicker'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import {
  isLocalWebhookBindAddress,
  localWebhookBaseUrl,
  localWebhookPublicUrlProblem
} from '../../../../../shared/webhooks/local-webhook-settings'
import { NumberField, SettingsRow, SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import type { SettingsHostScope } from '../host-scope/settings-host-scope'
import {
  getHostSettingUnsupportedNote,
  getHostSettingUpdateFailedMessage,
  useHostSetting,
  useSettingsHostLabel
} from '../host-scope/use-host-setting'

const LOOPBACK = '127.0.0.1'

/** This computer's addresses, as the pairing settings list them; a server's are not known here. */
function useLocalInterfaces(local: boolean): { name: string; address: string }[] {
  const [interfaces, setInterfaces] = useState<{ name: string; address: string }[]>([])
  useEffect(() => {
    if (!local) {
      return
    }
    let current = true
    window.api?.mobile
      ?.listNetworkInterfaces()
      .then((result) => {
        if (current) {
          setInterfaces(result.interfaces)
        }
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [local])
  return local ? interfaces : []
}

/** Local webhooks run on the host Settings names, so each row reads and writes that host. */
export function LocalWebhooksSettings({
  settings,
  hostScope
}: {
  settings: GlobalSettings
  hostScope: SettingsHostScope
}): React.JSX.Element {
  const t = useTranslate()
  const updateSettingsOrThrow = useAppStore((state) => state.updateSettingsOrThrow)
  const host = useSettingsHostLabel(hostScope.target)
  const hostArgs = {
    owner: hostScope.target,
    localSettings: settings,
    updateLocalSettings: updateSettingsOrThrow,
    updateFailedMessage: getHostSettingUpdateFailedMessage(host, t)
  }
  const enabled = useHostSetting({ ...hostArgs, settingKey: 'localWebhooksEnabled' })
  const bindAddress = useHostSetting({ ...hostArgs, settingKey: 'localWebhooksBindAddress' })
  const port = useHostSetting({ ...hostArgs, settingKey: 'localWebhooksPort' })
  const publicUrl = useHostSetting({ ...hostArgs, settingKey: 'localWebhooksPublicUrl' })
  const interfaces = useLocalInterfaces(hostScope.target.kind === 'local')
  const [publicUrlDraft, setPublicUrlDraft] = useState<string | null>(null)

  const ready =
    enabled.setting.state === 'ready' &&
    bindAddress.setting.state === 'ready' &&
    port.setting.state === 'ready' &&
    publicUrl.setting.state === 'ready'
  const on = enabled.setting.state === 'ready' && enabled.setting.value
  const address = bindAddress.setting.state === 'ready' ? bindAddress.setting.value : LOOPBACK
  const savedPublicUrl = publicUrl.setting.state === 'ready' ? publicUrl.setting.value : ''
  const shownPublicUrl = publicUrlDraft ?? savedPublicUrl
  const publicUrlProblem = localWebhookPublicUrlProblem(shownPublicUrl)
  const options: AddressOption[] = [
    {
      value: LOOPBACK,
      label: t('components.settings.localWebhooks.loopback', '{{address}} (this computer only)', {
        address: LOOPBACK
      })
    },
    ...interfaces.map((entry) => ({
      value: entry.address,
      label: `${entry.address} (${entry.name})`
    }))
  ]
  const known = options.some((option) => option.value === address)
  const savePublicUrl = (): void => {
    if (publicUrlDraft === null) {
      return
    }
    if (!localWebhookPublicUrlProblem(publicUrlDraft) && publicUrlDraft.trim() !== savedPublicUrl) {
      void publicUrl.update(publicUrlDraft.trim())
    }
    setPublicUrlDraft(null)
  }

  return (
    <SettingsGroup
      title={t('components.settings.localWebhooks.title', 'Local webhooks')}
      description={t(
        'components.settings.localWebhooks.description',
        'Take webhook calls on a port of {{host}}, without an Orca account. When on, they replace Orca Cloud webhooks on {{host}}; make each webhook again to get its local URL.',
        { host }
      )}
    >
      <SettingsSwitchRow
        label={t('components.settings.localWebhooks.enabled', 'Local webhooks')}
        description={
          enabled.setting.state === 'unsupported'
            ? getHostSettingUnsupportedNote(host, t)
            : on
              ? t('components.settings.localWebhooks.on', 'Enabled')
              : t('components.settings.localWebhooks.off', 'Disabled')
        }
        checked={on}
        disabled={!ready || !hostScope.available}
        onChange={() => void enabled.update(!on)}
      />
      {on ? (
        <>
          <SettingsRow
            label={t('components.settings.localWebhooks.interface', 'Listen on interface')}
            description={t(
              'components.settings.localWebhooks.interfaceHelp',
              'The address the listener binds on {{host}}. A reverse proxy, NetBird or Tailscale can forward to it.',
              { host }
            )}
            htmlFor="local-webhooks-interface"
            control={
              <AddressPicker
                id="local-webhooks-interface"
                className="min-w-[240px] max-w-full"
                triggerAriaLabel={t(
                  'components.settings.localWebhooks.interface',
                  'Listen on interface'
                )}
                options={options}
                customOptions={known ? [] : [{ value: address, label: address }]}
                valueIsCustom={!known}
                value={address}
                onValueChange={(value) => void bindAddress.update(value)}
                onCustomValueChange={(value) => void bindAddress.update(value)}
                placeholder=""
                customInputId="local-webhooks-custom-interface"
                formatCustomLabel={(value) =>
                  t('components.settings.localWebhooks.customOption', '{{address}} (custom)', {
                    address: value
                  })
                }
                addCustomLabel={t(
                  'components.settings.localWebhooks.addCustom',
                  'Use another address…'
                )}
                validateCustom={(input) =>
                  isLocalWebhookBindAddress(input)
                    ? { ok: true, value: input.trim() }
                    : { ok: false }
                }
                customDialogCopy={{
                  title: t('components.settings.localWebhooks.customTitle', 'Listen address'),
                  description: t(
                    'components.settings.localWebhooks.customDescription',
                    'An IPv4 or IPv6 address of {{host}}.',
                    { host }
                  ),
                  inputLabel: t('components.settings.localWebhooks.customLabel', 'Address'),
                  placeholder: '100.64.0.1',
                  hint: t(
                    'components.settings.localWebhooks.customHint',
                    'Enter an IP address, without a port.'
                  ),
                  cancel: t('components.settings.localWebhooks.cancel', 'Cancel'),
                  confirm: t('components.settings.localWebhooks.useAddress', 'Use address')
                }}
              />
            }
          />
          <NumberField
            label={t('components.settings.localWebhooks.port', 'Port')}
            description={t(
              'components.settings.localWebhooks.portHelp',
              'Its own port, apart from the server port, so only webhooks are reachable on it.'
            )}
            value={port.setting.state === 'ready' ? port.setting.value : Number.NaN}
            defaultValue={6790}
            min={1}
            max={65535}
            integer
            onChange={(value) => void port.update(value)}
          />
          <SettingsRow
            label={t('components.settings.localWebhooks.publicUrl', 'Public URL')}
            description={
              publicUrlProblem ??
              t(
                'components.settings.localWebhooks.publicUrlHelp',
                'Optional: the URL senders reach the listener at, for Copy URL. Empty shows the local address.'
              )
            }
            htmlFor="local-webhooks-public-url"
            control={
              <Input
                id="local-webhooks-public-url"
                value={shownPublicUrl}
                placeholder={t(
                  'components.settings.localWebhooks.publicUrlPlaceholder',
                  'https://hooks.example.net'
                )}
                aria-invalid={publicUrlProblem !== null}
                variant="code"
                className="w-72"
                onChange={(event) => setPublicUrlDraft(event.target.value)}
                onBlur={savePublicUrl}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    savePublicUrl()
                  }
                }}
              />
            }
          />
          <p className="pb-3 text-xs text-muted-foreground">
            {t('components.settings.localWebhooks.urlPreview', 'Webhook URLs: {{url}}', {
              url: `${localWebhookBaseUrl(
                address,
                port.setting.state === 'ready' ? port.setting.value : 6790,
                savedPublicUrl
              )}/hooks/…`
            })}
          </p>
        </>
      ) : null}
    </SettingsGroup>
  )
}
