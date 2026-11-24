// One row of the Profile Manager list: docs/fork/profiles-design.md, section 4.
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { AppProfileRow } from '../../../../shared/app-profiles/app-profile-rules'

/** The app name of a bundle path: "/Applications/Orca.app" gives "Orca". */
function appName(appPath: string): string {
  return (appPath.split('/').pop() ?? appPath).replace(/\.app$/, '')
}

/** The port that the profile's server listens on, and the saved port when it differs. */
export function livePortText(row: AppProfileRow, t: Translate): string | null {
  if (row.livePort === undefined) {
    return null
  }
  return row.livePort === row.port
    ? t('profileManager.port.running', 'Running on {{port}}', { port: row.livePort })
    : t(
        'profileManager.port.runningOther',
        'Running on {{port}} (saved port {{saved}}). A server started with --port uses that port, not the saved port.',
        { port: row.livePort, saved: row.port }
      )
}

function ProfileStatus(props: { state: AppProfileRow['state'] }): React.JSX.Element {
  const t = useTranslate()
  const running = props.state !== 'stopped'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        // green-700 has 4.5:1 contrast on white; #86efac on the dark card.
        running ? 'text-green-700 dark:text-[#86efac]' : 'text-muted-foreground'
      )}
    >
      <span
        aria-hidden="true"
        data-testid="profile-status-dot"
        className={cn(
          'size-2 rounded-full',
          running ? 'bg-[#22c55e]' : 'border border-muted-foreground'
        )}
      />
      {
        {
          running: t('profileManager.state.running', 'Running'),
          background: t('profileManager.state.background', 'Running in background'),
          stopped: t('profileManager.state.stopped', 'Stopped')
        }[props.state]
      }
    </span>
  )
}

export function ProfileRow(props: {
  row: AppProfileRow
  /** This app's own row. */
  current: boolean
  busy: boolean
  onOpen: () => void
  onEdit: () => void
  onShowInFinder: () => void
  onStartAtLogin: (enabled: boolean) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { row } = props
  const isDefault = row.id === 'default'
  const name = isDefault ? appName(row.appPath) : row.name
  const port =
    livePortText(row, t) ?? t('profileManager.port.saved', 'Port {{port}}', { port: row.port })
  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{name}</span>
          {isDefault ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {props.current
                ? t('profileManager.defaultThisApp', 'Default · this app')
                : t('profileManager.defaultName', 'Default')}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <code className="font-mono text-foreground/80">{row.id}</code>
          <span className="min-w-0 break-all">{row.appPath}</span>
        </div>
        <p className="text-xs text-muted-foreground">{port}</p>
      </div>
      <ProfileStatus state={row.state} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={props.onOpen}>
          {t('profileManager.open', 'Open')}
        </Button>
        {isDefault ? null : (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onEdit}>
            {t('profileManager.edit.button', 'Edit')}
          </Button>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('profileManager.more', 'More actions for {{name}}', { name })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onShowInFinder}>
              {t('profileManager.showInFinder', 'Show in Finder')}
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={row.startAtLogin}
              disabled={props.busy}
              onCheckedChange={(checked) => props.onStartAtLogin(checked === true)}
            >
              {t('profileManager.startAtLogin', 'Start at login')}
            </DropdownMenuCheckboxItem>
            {isDefault ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={props.busy}
                  onSelect={props.onRemove}
                >
                  {t('profileManager.remove.button', 'Remove profile…')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
