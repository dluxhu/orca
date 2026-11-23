// The Remove form of the Profile Manager: docs/fork/profiles-design.md, section 9.
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import type { AppProfileRow } from '../../../../shared/app-profiles/app-profile-rules'

export function ProfileRemoveForm(props: {
  row: AppProfileRow
  keepData: boolean
  busy: boolean
  onKeepData: (keepData: boolean) => void
  onRemove: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <section
      aria-label={t('profileManager.remove.label', 'Remove profile')}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 className="text-base font-semibold">
        {t('profileManager.remove.title', 'Remove {{name}}?', { name: props.row.name })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t(
          'profileManager.remove.note',
          'Orca moves the app to the Trash. Quit the profile first.'
        )}
      </p>
      <div className="flex items-center gap-2">
        <Checkbox
          id="profile-keep-data"
          checked={props.keepData}
          onCheckedChange={(checked) => props.onKeepData(checked === true)}
        />
        <Label htmlFor="profile-keep-data">
          {t(
            'profileManager.remove.keepData',
            'Keep data (a new profile with the id "{{id}}" gets it back)',
            { id: props.row.id }
          )}
        </Label>
      </div>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={props.busy} onClick={props.onRemove}>
          {t('profileManager.remove.confirm', 'Remove profile')}
        </Button>
        <Button variant="outline" disabled={props.busy} onClick={props.onCancel}>
          {t('profileManager.cancel', 'Cancel')}
        </Button>
      </div>
    </section>
  )
}
