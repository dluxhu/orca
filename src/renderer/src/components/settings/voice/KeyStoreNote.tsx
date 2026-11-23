import React from 'react'
import { Trans } from 'react-i18next'
import { LocalPathLink } from '@/components/file-actions/LocalPathLink'
import { i18n } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { localOrcaHomeDir, orcaHomeDisplay } from '@/lib/app-profile-path-display'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host/execution-host'

/** Where the voice dialogs keep local runtime keys, with a link that opens the folder. */
export function KeyStoreNote(): React.JSX.Element {
  const t = useTranslate()
  return (
    <span>
      <Trans
        i18n={i18n}
        defaults={t(
          'auto.components.settings.OpenAiTranscriptionKeyDialog.d246b2bdb3',
          'Local runtime keys are stored in <path>{{root}}</path> using Electron encrypted storage when available.'
        )}
        values={{ root: orcaHomeDisplay() }}
        components={{
          path: (
            <LocalPathLink
              label={orcaHomeDisplay()}
              path={localOrcaHomeDir()}
              hostId={LOCAL_EXECUTION_HOST_ID}
              kind="folder"
            />
          )
        }}
      />
    </span>
  )
}
