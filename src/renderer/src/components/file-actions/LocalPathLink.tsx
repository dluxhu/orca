import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { localOrcaHomeDir } from '@/lib/app-profile-path-display'
import { cn } from '@/lib/class-names'
import {
  isLocalExecutionHost,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host/execution-host'

/** Opens a folder, or shows a file in its folder, in the OS file manager. A missing path opens its parent folder. */
export async function openLocalPath(path: string, kind: 'file' | 'folder'): Promise<void> {
  const opened =
    kind === 'file'
      ? (await window.api.shell.openInFileManager(path, LOCAL_EXECUTION_HOST_ID)).ok
      : await window.api.shell.openFilePath(path, LOCAL_EXECUTION_HOST_ID)
  const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, '')
  if (!opened && parent && parent !== path) {
    // A missing parent too is a no-op: the label stays true, and the click has no error toast.
    await window.api.shell.openFilePath(parent, LOCAL_EXECUTION_HOST_ID)
  }
}

/**
 * A path label as a quiet link that opens the real path. Plain text when the path is not on this
 * computer or this window cannot open local files.
 */
export function LocalPathLink({
  label,
  path,
  hostId,
  kind,
  className
}: {
  label: string
  path: string | null
  hostId: string
  kind: 'file' | 'folder'
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  if (!path || !isLocalExecutionHost(hostId) || !localOrcaHomeDir()) {
    return <span className={className}>{label}</span>
  }
  return (
    <Button
      variant="link-muted"
      size="inlineText"
      className={cn(
        // Inside a sentence or a mono label: keep its font, and wrap like the text around it.
        'inline text-left font-normal break-all whitespace-normal text-[length:inherit] [font-family:inherit]',
        className
      )}
      aria-label={
        kind === 'file'
          ? t('components.localPathLink.showFile', 'Show {{path}} in its folder', { path: label })
          : t('components.localPathLink.openFolder', 'Open folder {{path}}', { path: label })
      }
      onClick={() => void openLocalPath(path, kind)}
    >
      {label}
    </Button>
  )
}
