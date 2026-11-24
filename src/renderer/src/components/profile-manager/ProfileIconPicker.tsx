// The icon part of the New and Edit profile dialogs: docs/fork/profiles-design.md, section 8.
// The main process makes the preview; this view only shows its PNG.
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/ui/color-picker'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import type { AppProfileIcon } from '../../../../shared/app-profiles/app-profile-paths'
import {
  APP_PROFILE_BADGE_COLOR,
  APP_PROFILE_BADGE_FILE,
  APP_PROFILE_ICON_FILE
} from '../../../../shared/app-profiles/app-profile-icon-files'
import { Field } from './ProfileField'
import { ProfileStyleGrid } from './ProfileStyleGrid'

/** True when the choice is complete: a badge character, or a chosen file. */
export function iconChoiceReady(icon: AppProfileIconSource): boolean {
  return icon.kind === 'badge' ? Boolean(icon.text?.trim()) : Boolean(icon.path)
}

/**
 * The first choice of a form: the profile's saved icon, else a new badge. An uploaded badge or icon
 * comes from its copy in the profile's userData.
 */
export function editIcon(
  icon: AppProfileIcon | undefined,
  defaultText: string,
  userDataPath = ''
): AppProfileIconSource {
  if (icon?.kind === 'badge') {
    return { kind: 'badge', text: icon.text, style: icon.style, color: icon.color }
  }
  if (icon?.kind === 'image') {
    return { kind: 'image', path: `${userDataPath}/${APP_PROFILE_BADGE_FILE}`, style: icon.style }
  }
  if (icon?.kind === 'file') {
    return { kind: 'file', path: `${userDataPath}/${APP_PROFILE_ICON_FILE}` }
  }
  return { kind: 'badge', text: defaultText, style: 'ref-match' }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

/** The swatches of the badge character colour. The first is the default. */
const BADGE_COLORS = [
  APP_PROFILE_BADGE_COLOR,
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#2563eb',
  '#9333ea'
] as const

/** The badge character colour: the swatches, then any colour. The default colour is no colour. */
function BadgeColors(props: {
  color?: string
  onChange: (color: string | undefined) => void
}): React.JSX.Element {
  const t = useTranslate()
  const current = props.color ?? APP_PROFILE_BADGE_COLOR
  const isCustom = !BADGE_COLORS.some((swatch) => swatch === current)
  const names: Record<(typeof BADGE_COLORS)[number], string> = {
    [APP_PROFILE_BADGE_COLOR]: t('profileManager.icon.colorDark', 'Dark'),
    '#dc2626': t('profileManager.icon.colorRed', 'Red'),
    '#ea580c': t('profileManager.icon.colorOrange', 'Orange'),
    '#16a34a': t('profileManager.icon.colorGreen', 'Green'),
    '#2563eb': t('profileManager.icon.colorBlue', 'Blue'),
    '#9333ea': t('profileManager.icon.colorPurple', 'Purple')
  }
  const pick = (color: string): void =>
    props.onChange(color === APP_PROFILE_BADGE_COLOR ? undefined : color)
  const custom = t('profileManager.icon.colorCustom', 'Custom color')
  const ring = 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
  return (
    <div className="flex flex-col gap-1.5">
      <Label id="profile-badge-color" className="font-semibold">
        {t('profileManager.icon.color', 'Character color')}
      </Label>
      <div
        role="group"
        aria-labelledby="profile-badge-color"
        className="flex h-9 items-center gap-2"
      >
        {BADGE_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={names[swatch]}
            aria-pressed={swatch === current}
            style={{ backgroundColor: swatch }}
            onClick={() => pick(swatch)}
            className={cn(
              'size-5 cursor-pointer rounded-full border border-black/10 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-white/15',
              swatch === current && ring
            )}
          />
        ))}
        {isCustom ? (
          <span
            aria-hidden
            style={{ backgroundColor: current }}
            className={cn('size-5 rounded-full border border-black/10 dark:border-white/15', ring)}
          />
        ) : null}
        <ColorPicker
          value={current}
          onChange={(next) => pick(next.toLowerCase())}
          label={custom}
          selected={isCustom}
          trigger={
            <button
              type="button"
              aria-label={custom}
              title={custom}
              className="flex size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Plus className="size-3" />
            </button>
          }
        />
      </div>
    </div>
  )
}

export function ProfileIconPicker(props: {
  value: AppProfileIconSource
  onChange: (icon: AppProfileIconSource) => void
  /** The first free badge character. */
  defaultText: string
}): React.JSX.Element {
  const t = useTranslate()
  const api = window.api.appProfiles
  const { value, onChange } = props
  const style = value.kind === 'file' ? undefined : (value.style ?? 'ref-match')
  const choose = (kind: 'image' | 'file'): void => {
    void api?.chooseIconFile(kind).then((path) => {
      if (path) {
        onChange(kind === 'image' ? { kind, path, style } : { kind, path })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Label id="profile-icon-mode" className="font-semibold">
        {t('profileManager.icon.label', 'Icon')}
      </Label>
      <ToggleGroup
        type="single"
        variant="segmented-card"
        className="grid-cols-3"
        aria-labelledby="profile-icon-mode"
        value={value.kind}
        onValueChange={(kind) => {
          if (kind === 'badge') {
            onChange({ kind, text: props.defaultText, style })
          } else if (kind === 'image') {
            onChange({ kind, path: '', style })
          } else if (kind === 'file') {
            onChange({ kind, path: '' })
          }
        }}
      >
        <ToggleGroupItem value="badge">
          {t('profileManager.icon.modeBadge', 'Badge character')}
        </ToggleGroupItem>
        <ToggleGroupItem value="image">
          {t('profileManager.icon.modeImage', 'Badge image')}
        </ToggleGroupItem>
        <ToggleGroupItem value="file">
          {t('profileManager.icon.modeFile', 'Own icon')}
        </ToggleGroupItem>
      </ToggleGroup>
      {value.kind === 'badge' ? (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <Field
              name="badge"
              label={t('profileManager.icon.badge', 'Badge character')}
              value={value.text ?? ''}
              inputClassName="w-16 text-center text-lg font-bold md:text-lg"
              note={t(
                'profileManager.icon.badgeNote',
                'Default: the next number that no profile uses (2, 3, 4, …). A letter or an emoji also works.'
              )}
              onChange={(text) => onChange({ ...value, text })}
            />
          </div>
          <BadgeColors color={value.color} onChange={(color) => onChange({ ...value, color })} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => choose(value.kind)}>
            {value.kind === 'image'
              ? t('profileManager.icon.chooseImage', 'Choose a badge image…')
              : t('profileManager.icon.chooseFile', 'Choose an icon file…')}
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {value.path
              ? fileName(value.path)
              : value.kind === 'image'
                ? t(
                    'profileManager.icon.imageNote',
                    'PNG, JPEG, WebP, SVG or ICNS. Orca puts it in the corner.'
                  )
                : t(
                    'profileManager.icon.fileNote',
                    'A 1024 × 1024 PNG or an ICNS file. It replaces the Orca icon; no badge.'
                  )}
          </span>
        </div>
      )}
      {value.kind !== 'file' && style ? (
        <ProfileStyleGrid style={style} onChange={(next) => onChange({ ...value, style: next })} />
      ) : null}
    </div>
  )
}

// The CLI takes seconds for a preview: a quick series of changes (typing, a colour drag) makes one.
const PREVIEW_DELAY_MS = 300

const dockSamples = [
  {
    key: 'light',
    sample: 'bg-gradient-to-b from-[#e8ecf2] to-[#cfd6e0]',
    dock: 'border-white/80 bg-white/55'
  },
  {
    key: 'dark',
    sample: 'bg-gradient-to-b from-[#1f2937] to-[#0b1220]',
    dock: 'border-white/15 bg-white/10'
  }
]

/** The preview of the icon on a light and on a dark Dock, as the main process makes it. */
export function ProfileIconPreview(props: {
  value: AppProfileIconSource
  /** The profile that the Edit dialog changes; its own badge character is free. */
  profileId?: string | null
  /** The default app's icon, shown next to the preview as in the Dock. */
  appIcon?: string
}): React.JSX.Element {
  const t = useTranslate()
  const api = window.api.appProfiles
  const [preview, setPreview] = useState<{ png: string } | { error: string } | null>(null)
  const key = JSON.stringify(props.value)
  const ready = iconChoiceReady(props.value)

  useEffect(() => {
    if (!api || !ready) {
      setPreview(null)
      return
    }
    let current = true
    setPreview(null)
    const timer = setTimeout(() => {
      void api
        .iconPreview(JSON.parse(key) as AppProfileIconSource, props.profileId)
        .then((reply) => {
          if (current) {
            setPreview(
              reply.ok
                ? { png: (reply.result as { png: string }).png }
                : { error: reply.error.message }
            )
          }
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, key, ready, props.profileId])

  return (
    <aside
      aria-label={t('profileManager.icon.preview', 'Preview')}
      className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5"
    >
      <span className="font-semibold">{t('profileManager.icon.preview', 'Preview')}</span>
      {dockSamples.map((sample, index) => (
        <div key={sample.key} className={`flex justify-center rounded-[14px] p-5 ${sample.sample}`}>
          <div className={`flex items-end gap-3 rounded-[18px] border px-4 py-2.5 ${sample.dock}`}>
            {props.appIcon ? (
              <img src={props.appIcon} alt="" className="size-14 opacity-85" />
            ) : null}
            {preview && 'png' in preview ? (
              <img
                className="size-24"
                // The dark sample shows the same image again.
                alt={index === 0 ? t('profileManager.icon.previewAlt', 'Preview of the icon') : ''}
                src={`data:image/png;base64,${preview.png}`}
              />
            ) : (
              <div className="flex size-24 items-center justify-center text-center text-xs text-slate-600">
                {ready && index === 0
                  ? t('profileManager.icon.making', 'Making the preview…')
                  : null}
              </div>
            )}
          </div>
        </div>
      ))}
      {preview && 'error' in preview ? (
        <p role="alert" className="text-xs text-destructive">
          {preview.error}
        </p>
      ) : null}
    </aside>
  )
}
