// The Remove dialog of the Profile Manager: docs/fork/profiles-design.md, section 9.
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
import { DialogCancel } from '@/components/ui/dialog-parts'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import type { AppProfileRow } from '../../../../shared/app-profiles/app-profile-rules'

export function ProfileRemoveForm(props: {
  row: AppProfileRow
  /** The error of the last change. */
  alert: React.ReactNode
  keepData: boolean
  busy: boolean
  onKeepData: (keepData: boolean) => void
  onRemove: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onCancel())}>
      <DialogContent size="confirm" busy={props.busy} initialFocus="cancel" className="bg-popover">
        <DialogHeader>
          <DialogTitle>
            {t('profileManager.remove.title', 'Remove {{name}}?', { name: props.row.name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'profileManager.remove.note',
              'Orca moves the app to the Trash. Quit the profile first.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            id="profile-keep-data"
            checked={props.keepData}
            onCheckedChange={(checked) => props.onKeepData(checked === true)}
          />
          <Label htmlFor="profile-keep-data" variant="dialog">
            {t(
              'profileManager.remove.keepData',
              'Keep data (a new profile with the id "{{id}}" gets it back)',
              { id: props.row.id }
            )}
          </Label>
        </div>
        {props.alert}
        <DialogFooter>
          <DialogCancel>{t('profileManager.cancel', 'Cancel')}</DialogCancel>
          <Button size="sm" variant="destructive" disabled={props.busy} onClick={props.onRemove}>
            {t('profileManager.remove.confirm', 'Remove profile')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
