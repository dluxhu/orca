// The New profile and Edit dialogs of the Profile Manager: docs/fork/profiles-design.md, section 4.
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import {
  appProfileIdError,
  appProfileNameError,
  appProfilePortError,
  appProfileIdFromName,
  nextBadgeText,
  type AppProfileChange,
  type AppProfileIconSource as IconSource,
  type AppProfileRow,
  type AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'
import { Field } from './ProfileField'
import {
  editIcon,
  iconChoiceReady,
  ProfileIconPicker,
  ProfileIconPreview
} from './ProfileIconPicker'

/** The first badge character that no other profile uses. `row`: the profile that Edit changes. */
export function freeBadge(state: AppProfilesState | null, row: AppProfileRow | null): string {
  return nextBadgeText(
    (state?.rows ?? []).filter((other) => other.id !== row?.id).map((other) => other.icon)
  )
}

export type ProfileForm =
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

export function ProfileFormDialog(props: {
  form: ProfileForm
  state: AppProfilesState | null
  busy: boolean
  /** The error of the last change. */
  alert: React.ReactNode
  onChange: (form: ProfileForm) => void
  onRun: (changes: AppProfileChange[]) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { form, onChange } = props
  const others = (props.state?.rows ?? []).filter(
    (row) => row.id !== 'default' && (form.mode === 'new' || row.id !== form.row.id)
  )
  const nameError = appProfileNameError(
    form.name,
    others.map((row) => row.name),
    t
  )
  const portError = appProfilePortError(
    Number(form.port),
    others.map((row) => row.port),
    t
  )
  const idError =
    form.mode === 'new'
      ? appProfileIdError(
          form.id,
          others.map((row) => row.id),
          t
        )
      : null
  const row = form.mode === 'edit' ? form.row : null
  const badge = freeBadge(props.state, row)
  const changes: AppProfileChange[] =
    form.mode === 'new'
      ? [
          {
            kind: 'create',
            name: form.name.trim(),
            id: form.id,
            port: Number(form.port),
            copySettings: form.copySettings,
            icon: form.icon
          }
        ]
      : [
          ...(form.name.trim() !== form.row.name
            ? [{ kind: 'rename' as const, id: form.row.id, name: form.name.trim() }]
            : []),
          ...(Number(form.port) !== form.row.port
            ? [{ kind: 'set-port' as const, id: form.row.id, port: Number(form.port) }]
            : []),
          ...(JSON.stringify(form.icon) !==
          JSON.stringify(editIcon(form.row.icon, badge, form.row.userDataPath))
            ? [{ kind: 'set-icon' as const, id: form.row.id, icon: form.icon }]
            : [])
        ]
  const kept = form.mode === 'new' && (props.state?.keptIds.includes(form.id) ?? false)
  const idNote = kept
    ? t(
        'profileManager.field.idKept',
        'A data folder for "{{id}}" exists. The new profile uses that data.',
        { id: form.mode === 'new' ? form.id : '' }
      )
    : t(
        'profileManager.field.idNote',
        'Made from the name. Use it as orca … --profile {{id}}. It does not change later.',
        { id: form.mode === 'new' ? form.id : '' }
      )

  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onClose())}>
      <DialogContent busy={props.busy} scrollable className="gap-0 p-0 sm:max-w-[980px]">
        <DialogHeader className="gap-1 border-b px-6 py-5 text-left">
          <DialogTitle>
            {form.mode === 'new'
              ? t('profileManager.new.title', 'New profile')
              : t('profileManager.edit.title', 'Edit {{name}}', { name: form.row.name })}
          </DialogTitle>
          <DialogDescription>
            {form.mode === 'new'
              ? t(
                  'profileManager.new.intro',
                  'Orca makes a new Mac app for this profile. It runs next to your other profiles, with its own windows, Dock icon, notifications, sign-ins and chats.'
                )
              : t(
                  'profileManager.edit.nameNote',
                  'The id and the data stay. Quit the profile first.'
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-8 p-6">
          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
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
                onChange(
                  form.mode === 'new'
                    ? { ...form, name, id: form.idEdited ? form.id : appProfileIdFromName(name) }
                    : { ...form, name }
                )
              }
            />
            {form.mode === 'new' ? (
              <Field
                name="id"
                mono
                label={t('profileManager.field.id', 'Profile id')}
                value={form.id}
                error={idError}
                note={idNote}
                onChange={(id) => onChange({ ...form, id, idEdited: true })}
              />
            ) : null}
            <Field
              name="port"
              mono
              inputClassName="w-[120px]"
              label={t('profileManager.field.port', 'Server port')}
              value={form.port}
              error={portError}
              note={t(
                'profileManager.field.portNote',
                "This profile's server and remote devices use this port. Each profile has its own. Default: the next free port."
              )}
              onChange={(port) => onChange({ ...form, port })}
            />
            <ProfileIconPicker
              value={form.icon}
              defaultText={badge}
              onChange={(icon) => onChange({ ...form, icon })}
            />
          </div>
          <ProfileIconPreview
            value={form.icon}
            profileId={row?.id}
            appIcon={props.state?.icons?.default}
          />
        </div>
        {props.alert ? <div className="px-6 pb-4">{props.alert}</div> : null}
        <DialogFooter className="flex-row flex-wrap items-center justify-between gap-3 border-t px-6 py-4 sm:justify-between">
          {/* The Profile Manager app has no settings of its own to copy. */}
          {form.mode === 'new' && props.state?.currentId !== null ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="profile-copy-settings"
                checked={form.copySettings}
                onCheckedChange={(checked) => onChange({ ...form, copySettings: checked === true })}
              />
              <Label htmlFor="profile-copy-settings">
                {t('profileManager.new.copySettings', 'Copy settings from this app')}
              </Label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
              {t('profileManager.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={
                props.busy ||
                changes.length === 0 ||
                Boolean(nameError ?? idError ?? portError) ||
                !iconChoiceReady(form.icon)
              }
              onClick={() => props.onRun(changes)}
            >
              {form.mode === 'new'
                ? t('profileManager.new.create', 'Create profile')
                : t('profileManager.edit.save', 'Save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
