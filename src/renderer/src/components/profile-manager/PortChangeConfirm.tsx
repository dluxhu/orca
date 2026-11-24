// The confirm before a change of a saved port: Settings and the Profile Manager's Edit dialog.
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DialogCancel } from '@/components/ui/dialog-parts'
import { useTranslate } from '@/i18n/use-translate'

/** Open while `port` is not null. */
export function PortChangeConfirm(props: {
  port: number | null
  /** appPortWarning of the new port. */
  warning?: string | null
  busy: boolean
  onCancel: () => void
  onConfirm: (port: number) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { port } = props
  return (
    <Dialog open={port !== null} onOpenChange={(open) => (open ? null : props.onCancel())}>
      <DialogContent size="confirm" busy={props.busy} initialFocus="cancel">
        <DialogHeader>
          <DialogTitle>
            {t('profileManager.portConfirm.title', 'Change the port to {{port}}?', {
              port: port ?? ''
            })}
          </DialogTitle>
          <DialogDescription>
            {t('profileManager.portConfirm.note', 'Paired servers will need to be re-paired.')}
          </DialogDescription>
        </DialogHeader>
        {props.warning ? <p className="text-sm text-muted-foreground">{props.warning}</p> : null}
        <DialogFooter>
          <DialogCancel>{t('profileManager.cancel', 'Cancel')}</DialogCancel>
          <Button
            size="sm"
            disabled={props.busy}
            onClick={() => (port === null ? undefined : props.onConfirm(port))}
          >
            {t('profileManager.portConfirm.confirm', 'Change port')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
