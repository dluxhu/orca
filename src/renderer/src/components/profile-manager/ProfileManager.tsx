// The Profile Manager window: docs/fork/profiles-design.md, sections 4 and 9.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Field } from './ProfileField'
import { editIcon, iconChoiceReady, ProfileIconPicker } from './ProfileIconPicker'
import { ProfileRemoveForm } from './ProfileRemoveForm'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  appProfileIdError,
  appProfileIdFromName,
  appProfileNameError,
  appProfilePortError,
  nextAppProfilePort,
  nextBadgeText,
  type AppProfileChange,
  type AppProfileIconSource as IconSource,
  type AppProfileRow,
  type AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'

function stateLabel(t: Translate, state: AppProfileRow['state']): string {
  return {
    running: t('profileManager.state.running', 'Running'),
    background: t('profileManager.state.background', 'Running in background'),
    stopped: t('profileManager.state.stopped', 'Stopped')
  }[state]
}

type Form =
  | {
      mode: 'new'
      name: string
      id: string
      idEdited: boolean
      port: string
      copySettings: boolean
      icon: IconSource
    }
  | { mode: 'edit'; row: AppProfileRow; name: string; port: string; icon: IconSource }
  | { mode: 'remove'; row: AppProfileRow; keepData: boolean }

function newProfileName(t: Translate, taken: readonly string[]): string {
  const lower = taken.map((name) => name.toLowerCase())
  let name = t('profileManager.new.defaultName', 'Orca - New Profile')
  for (let n = 2; lower.includes(name.toLowerCase()); n++) {
    name = t('profileManager.new.defaultNameNumbered', 'Orca - New Profile {{n}}', { n })
  }
  return name
}

export function ProfileManager(): React.JSX.Element {
  const t = useTranslate()
  const api = window.api.appProfiles
  const [state, setState] = useState<AppProfilesState | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (api) {
      setState(await api.getState())
    }
  }, [api])

  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  if (!api) {
    return <p className="p-6">{t('profileManager.macOnly', 'Profiles are only on macOS.')}</p>
  }
  const profiles = state?.rows.filter((row) => row.id !== 'default') ?? []
  const others = (row: AppProfileRow | null): AppProfileRow[] =>
    profiles.filter((profile) => profile.id !== row?.id)
  const badgeFor = (row: AppProfileRow | null): string =>
    nextBadgeText(others(row).map((profile) => profile.icon))

  /** Runs the changes in order and stops at the first error. */
  const run = (changes: AppProfileChange[]): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const runAll = async (): Promise<void> => {
      for (const change of changes) {
        const reply = await api.change(change)
        if (!reply.ok) {
          setMessage(reply.error.message)
          return
        }
      }
      setForm(null)
    }
    // Promise.finally: React Compiler cannot compile a try/finally statement.
    return runAll().finally(async () => {
      setBusy(false)
      await load()
    })
  }

  const startNew = (): void => {
    const name = newProfileName(
      t,
      profiles.map((row) => row.name)
    )
    setForm({
      mode: 'new',
      name,
      id: appProfileIdFromName(name),
      idEdited: false,
      port: String(nextAppProfilePort(profiles.map((row) => row.port))),
      copySettings: false,
      icon: editIcon(undefined, badgeFor(null))
    })
    setMessage(null)
  }

  let formView: React.JSX.Element | null = null
  if (form?.mode === 'new') {
    const nameError = appProfileNameError(
      form.name,
      profiles.map((row) => row.name),
      t
    )
    const idError = appProfileIdError(
      form.id,
      profiles.map((row) => row.id),
      t
    )
    const portError = appProfilePortError(
      Number(form.port),
      profiles.map((row) => row.port),
      t
    )
    const kept = state?.keptIds.includes(form.id) ?? false
    formView = (
      <section
        aria-label={t('profileManager.new.title', 'New profile')}
        className="flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 className="text-base font-semibold">{t('profileManager.new.title', 'New profile')}</h2>
        <Field
          name="name"
          label={t('profileManager.field.name', 'App name')}
          value={form.name}
          error={nameError}
          note={t(
            'profileManager.field.nameNote',
            'Shown in the Dock, the menu bar and notifications.'
          )}
          onChange={(name) =>
            setForm({ ...form, name, id: form.idEdited ? form.id : appProfileIdFromName(name) })
          }
        />
        <Field
          name="id"
          label={t('profileManager.field.id', 'Profile id')}
          value={form.id}
          error={idError}
          note={
            kept
              ? t(
                  'profileManager.field.idKept',
                  'A data folder for "{{id}}" exists. The new profile uses that data.',
                  { id: form.id }
                )
              : t(
                  'profileManager.field.idNote',
                  'The data folder and the bundle id use it. It does not change later.'
                )
          }
          onChange={(id) => setForm({ ...form, id, idEdited: true })}
        />
        <Field
          name="port"
          label={t('profileManager.field.port', 'Server port')}
          value={form.port}
          error={portError}
          onChange={(port) => setForm({ ...form, port })}
        />
        <ProfileIconPicker
          value={form.icon}
          defaultText={badgeFor(null)}
          onChange={(icon) => setForm({ ...form, icon })}
        />
        {/* The Profile Manager app has no settings of its own to copy. */}
        {state?.currentId === null ? null : (
          <div className="flex items-center gap-2">
            <Checkbox
              id="profile-copy-settings"
              checked={form.copySettings}
              onCheckedChange={(checked) => setForm({ ...form, copySettings: checked === true })}
            />
            <Label htmlFor="profile-copy-settings">
              {t('profileManager.new.copySettings', 'Copy settings from this app')}
            </Label>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            disabled={
              busy || Boolean(nameError ?? idError ?? portError) || !iconChoiceReady(form.icon)
            }
            onClick={() =>
              void run([
                {
                  kind: 'create',
                  name: form.name.trim(),
                  id: form.id,
                  port: Number(form.port),
                  copySettings: form.copySettings,
                  icon: form.icon
                }
              ])
            }
          >
            {t('profileManager.new.create', 'Create profile')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>
            {t('profileManager.cancel', 'Cancel')}
          </Button>
        </div>
      </section>
    )
  } else if (form?.mode === 'edit') {
    const nameError = appProfileNameError(
      form.name,
      others(form.row).map((row) => row.name),
      t
    )
    const portError = appProfilePortError(
      Number(form.port),
      others(form.row).map((row) => row.port),
      t
    )
    const changes: AppProfileChange[] = [
      ...(form.name.trim() !== form.row.name
        ? [{ kind: 'rename' as const, id: form.row.id, name: form.name.trim() }]
        : []),
      ...(Number(form.port) !== form.row.port
        ? [{ kind: 'set-port' as const, id: form.row.id, port: Number(form.port) }]
        : []),
      ...(JSON.stringify(form.icon) !==
      JSON.stringify(editIcon(form.row.icon, badgeFor(form.row), form.row.userDataPath))
        ? [{ kind: 'set-icon' as const, id: form.row.id, icon: form.icon }]
        : [])
    ]
    formView = (
      <section
        aria-label={t('profileManager.edit.label', 'Edit profile')}
        className="flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 className="text-base font-semibold">
          {t('profileManager.edit.title', 'Edit {{name}}', { name: form.row.name })}
        </h2>
        <Field
          name="name"
          label={t('profileManager.field.name', 'App name')}
          value={form.name}
          error={nameError}
          note={t(
            'profileManager.edit.nameNote',
            'The id and the data stay. Quit the profile first.'
          )}
          onChange={(name) => setForm({ ...form, name })}
        />
        <Field
          name="port"
          label={t('profileManager.field.port', 'Server port')}
          value={form.port}
          error={portError}
          onChange={(port) => setForm({ ...form, port })}
        />
        <ProfileIconPicker
          value={form.icon}
          defaultText={badgeFor(form.row)}
          profileId={form.row.id}
          onChange={(icon) => setForm({ ...form, icon })}
        />
        <div className="flex gap-2">
          <Button
            disabled={
              busy ||
              changes.length === 0 ||
              Boolean(nameError ?? portError) ||
              !iconChoiceReady(form.icon)
            }
            onClick={() => void run(changes)}
          >
            {t('profileManager.edit.save', 'Save')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>
            {t('profileManager.cancel', 'Cancel')}
          </Button>
        </div>
      </section>
    )
  } else if (form?.mode === 'remove') {
    formView = (
      <ProfileRemoveForm
        row={form.row}
        keepData={form.keepData}
        busy={busy}
        onKeepData={(keepData) => setForm({ ...form, keepData })}
        onRemove={() => void run([{ kind: 'remove', id: form.row.id, keepData: form.keepData }])}
        onCancel={() => setForm(null)}
      />
    )
  }

  return (
    <main className="scrollbar-sleek flex h-screen flex-col gap-4 overflow-auto bg-background p-6 text-foreground">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t('profileManager.heading', 'Profiles')}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'profileManager.intro',
              'Each profile is its own Mac app with its own windows, Dock icon, sign-ins and chats.'
            )}
          </p>
        </div>
        <Button disabled={busy} onClick={startNew}>
          {t('profileManager.new.title', 'New profile')}
        </Button>
      </header>
      {message ? (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {message}
        </p>
      ) : null}
      {formView}
      <ul
        aria-label={t('profileManager.list', 'Your profiles')}
        className="flex flex-col divide-y rounded-lg border"
      >
        {(state?.rows ?? []).map((row) => (
          <li key={row.id} className="flex items-center gap-4 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {row.id === 'default' ? t('profileManager.defaultName', 'Default') : row.name}
                {row.id === state?.currentId ? (
                  <span className="text-muted-foreground">
                    {t('profileManager.thisApp', ' · this app')}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {row.id} · {row.appPath}
              </div>
            </div>
            <span className="text-sm">{stateLabel(t, row.state)}</span>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`profile-start-at-login-${row.id}`}
                checked={row.startAtLogin}
                disabled={busy}
                onCheckedChange={(checked) =>
                  void run([{ kind: 'start-at-login', id: row.id, enabled: checked === true }])
                }
              />
              <Label htmlFor={`profile-start-at-login-${row.id}`}>
                {t('profileManager.startAtLogin', 'Start at login')}
              </Label>
            </div>
            <Button size="sm" variant="outline" onClick={() => void api.open(row.id)}>
              {t('profileManager.open', 'Open')}
            </Button>
            {row.id === 'default' ? null : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setForm({
                      mode: 'edit',
                      row,
                      name: row.name,
                      port: String(row.port),
                      icon: editIcon(row.icon, badgeFor(row), row.userDataPath)
                    })
                  }
                >
                  {t('profileManager.edit.button', 'Edit')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={t('profileManager.remove.buttonLabel', 'Remove {{name}}', {
                    name: row.name
                  })}
                  onClick={() => setForm({ mode: 'remove', row, keepData: true })}
                >
                  {t('profileManager.remove.button', 'Remove')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
