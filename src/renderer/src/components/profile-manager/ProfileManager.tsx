// The Profile Manager window: docs/fork/profiles-design.md, sections 4 and 9.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  appProfileIdFromName,
  nextAppProfilePort,
  type AppProfileChange,
  type AppProfileRow,
  type AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'
import { ProfileFormDialog, type ProfileForm } from './ProfileFormDialog'
import { ProfileRemoveForm } from './ProfileRemoveForm'
import { ProfileRow } from './ProfileRow'

/** The list reads the states again at this interval while the window shows. One read is cheap. */
export const PROFILE_STATE_POLL_MS = 2000

type Form = ProfileForm | { mode: 'remove'; row: AppProfileRow; keepData: boolean }

function newProfileName(t: Translate, taken: readonly string[]): string {
  const lower = taken.map((name) => name.toLowerCase())
  let name = t('profileManager.new.defaultName', 'Orca - New Profile')
  for (let n = 2; lower.includes(name.toLowerCase()); n++) {
    name = t('profileManager.new.defaultNameNumbered', 'Orca - New Profile {{n}}', { n })
  }
  return name
}

/** The first values of the New dialog. */
function newForm(t: Translate, state: AppProfilesState | null): ProfileForm {
  const profiles = state?.rows.filter((row) => row.id !== 'default') ?? []
  const name = newProfileName(
    t,
    profiles.map((row) => row.name)
  )
  return {
    mode: 'new',
    name,
    id: appProfileIdFromName(name),
    idEdited: false,
    port: String(nextAppProfilePort(profiles.map((row) => row.port))),
    copySettings: false
  }
}

const sectionHeading = 'text-[13px] font-semibold tracking-wide text-muted-foreground uppercase'
const code = 'font-mono text-[0.95em]'

export function ProfileManager(): React.JSX.Element {
  const t = useTranslate()
  const api = window.api.appProfiles
  const [state, setState] = useState<AppProfilesState | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  // Profiles > New profile…: the URL hash of a new window, or an event to the open window.
  const [wantNew, setWantNew] = useState(() => window.location.hash === '#new')
  const loading = useRef(false)
  const again = useRef(false)

  /** The one read of the list. A call during a read asks for one more read after it. */
  const load = useCallback(async (): Promise<void> => {
    if (!api) {
      return
    }
    if (loading.current) {
      again.current = true
      return
    }
    loading.current = true
    do {
      again.current = false
      await api.getState().then(
        (next) => {
          setState(next)
          setReadError(null)
        },
        (error: unknown) => setReadError(error instanceof Error ? error.message : String(error))
      )
    } while (again.current)
    loading.current = false
  }, [api])

  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    // macOS hides a covered window; the list is old when it shows again.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void load()
      }
    }
    // Apps start and stop without a sign to this window, so it reads the states again.
    const timer = setInterval(onVisible, PROFILE_STATE_POLL_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => api?.onStartNew(() => setWantNew(true)), [api])

  useEffect(() => {
    // The New dialog shows already: the request is done.
    if (wantNew && form?.mode === 'new') {
      setWantNew(false)
      return
    }
    // The defaults of the New dialog need the list. An open dialog keeps its input; New waits.
    if (wantNew && state && !form) {
      setWantNew(false)
      setForm(newForm(t, state))
      setMessage(null)
    }
  }, [wantNew, state, form, t])

  if (!api) {
    return <p className="p-6">{t('profileManager.macOnly', 'Profiles are only on macOS.')}</p>
  }
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
    setForm(newForm(t, state))
    setMessage(null)
  }

  const shown = message ?? readError
  const alert = shown ? (
    <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
      {shown}
    </p>
  ) : null

  return (
    <main className="scrollbar-sleek h-screen overflow-auto bg-background text-sm text-foreground">
      <div className="mx-auto flex max-w-[920px] flex-col gap-7 px-10 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-[560px] flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold">{t('profileManager.heading', 'Profiles')}</h1>
            <p className="leading-normal text-muted-foreground">
              {t(
                'profileManager.intro',
                'Run several Orca apps at the same time. Each profile is an independent Mac app with its own windows, Dock icon, notifications, sign-ins and chats.'
              )}
            </p>
          </div>
          <Button disabled={busy || !state} onClick={startNew}>
            <Plus />
            {t('profileManager.new.title', 'New profile')}
          </Button>
        </header>
        {form ? null : alert}
        <section aria-labelledby="profile-list-heading" className="flex flex-col gap-2.5">
          <h2 id="profile-list-heading" className={sectionHeading}>
            {t('profileManager.list', 'Your profiles')}
          </h2>
          <ul className="flex flex-col divide-y rounded-[10px] border bg-card">
            {(state?.rows ?? []).map((row) => (
              <ProfileRow
                key={row.id}
                row={row}
                current={row.id === state?.currentId}
                busy={busy}
                onOpen={() => void api.open(row.id)}
                onEdit={() =>
                  setForm({
                    mode: 'edit',
                    row,
                    name: row.name,
                    port: String(row.port),
                    startAtLogin: row.startAtLogin
                  })
                }
                onShowInFinder={() => void api.showInFinder(row.id)}
                onStartAtLogin={(enabled) =>
                  void run([{ kind: 'start-at-login', id: row.id, enabled }])
                }
                onRemove={() => setForm({ mode: 'remove', row, keepData: true })}
              />
            ))}
          </ul>
        </section>
        <section aria-labelledby="profile-cli-heading" className="flex flex-col gap-2.5">
          <h2 id="profile-cli-heading" className={sectionHeading}>
            {t('profileManager.cli.heading', 'Command line')}
          </h2>
          <div className="flex flex-col gap-3 rounded-[10px] border bg-card px-4 py-3.5">
            <p className="leading-normal">
              {t(
                'profileManager.cli.intro',
                'An orca command goes to the profile of the terminal it runs in. In any other terminal it goes to the default profile. Put --profile <id> before the command to pick another one.'
              )}
            </p>
            <pre className={`overflow-x-auto rounded-lg bg-background p-3 text-xs ${code}`}>
              {'orca --profile work chat list\norca --profile work serve'}
            </pre>
            <p className="text-xs leading-normal text-muted-foreground">
              {t(
                'profileManager.cli.serve',
                "orca serve runs one server per profile, on the profile's own port."
              )}
            </p>
          </div>
        </section>
      </div>
      {form?.mode === 'remove' ? (
        <ProfileRemoveForm
          row={form.row}
          alert={alert}
          keepData={form.keepData}
          busy={busy}
          onKeepData={(keepData) => setForm({ ...form, keepData })}
          onRemove={() => void run([{ kind: 'remove', id: form.row.id, keepData: form.keepData }])}
          onCancel={() => setForm(null)}
        />
      ) : form ? (
        <ProfileFormDialog
          form={form}
          state={state}
          busy={busy}
          alert={alert}
          onChange={setForm}
          onRun={(changes) => void run(changes)}
          onClose={() => setForm(null)}
        />
      ) : null}
    </main>
  )
}
