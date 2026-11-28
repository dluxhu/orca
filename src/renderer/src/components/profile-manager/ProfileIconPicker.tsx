// The icon chooser of the New and Edit profile dialogs and of Settings > Appearance: a base icon
// (built-in or uploaded) and an optional badge. See docs/fork/profiles-design.md, section 8.
// The main process makes the preview; this view only shows its PNG.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate } from '@/i18n/use-translate'
import {
  isBuiltInIconBase,
  type AppProfileIconSource,
  type AppProfileReply,
  type ChosenIconFile
} from '../../../../shared/app-profiles/app-profile-rules'
import type { AppProfileIcon } from '../../../../shared/app-profiles/app-profile-paths'
import {
  APP_PROFILE_BADGE_FILE,
  APP_PROFILE_BASE_FILE,
  APP_PROFILE_ICON_FILE
} from '../../../../shared/app-profiles/app-profile-icon-files'
import { Field } from './ProfileField'
import { BadgeColors, BaseIcons, fileName } from './ProfileIconParts'
import { ProfileStyleGrid } from './ProfileStyleGrid'
import { importFailureText } from '../settings/appearance/AppIconSelector'

// One size for the chooser in the Profile Manager and in Settings (its pane is 720 px wide): a
// change of base, badge or style never moves the controls or the preview. Longer text scrolls.
export const ICON_PICKER_SIZE = 'h-[640px] w-[420px] shrink-0'
const ICON_PREVIEW_WIDTH = 'w-[260px] shrink-0'

/** True when the choice is complete: a badge character, or a chosen file. */
export function iconChoiceReady(icon: AppProfileIconSource): boolean {
  if (icon.kind === 'none') {
    return true
  }
  return icon.kind === 'badge' ? Boolean(icon.text?.trim()) : Boolean(icon.path)
}

/** The base of a choice: a built-in id, or the path of an uploaded image ('' before the choice). */
export function iconBaseOf(icon: AppProfileIconSource): string {
  return icon.kind === 'file' ? icon.path : (icon.base ?? 'classic')
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
  // A kept uploaded base is `custom`; a built-in base other than classic is its id.
  const keptBase = (base?: string): { base?: string } =>
    base === 'custom'
      ? { base: `${userDataPath}/${APP_PROFILE_BASE_FILE}` }
      : base && base !== 'classic'
        ? { base }
        : {}
  if (icon?.kind === 'badge') {
    const color = icon.color ? { color: icon.color } : {}
    return { kind: 'badge', text: icon.text, style: icon.style, ...color, ...keptBase(icon.base) }
  }
  if (icon?.kind === 'image') {
    const path = `${userDataPath}/${APP_PROFILE_BADGE_FILE}`
    return { kind: 'image', path, style: icon.style, ...keptBase(icon.base) }
  }
  if (icon?.kind === 'none') {
    return { kind: 'none', base: icon.base }
  }
  if (icon?.kind === 'file') {
    return { kind: 'file', path: `${userDataPath}/${APP_PROFILE_ICON_FILE}` }
  }
  return { kind: 'badge', text: defaultText, style: 'ref-match' }
}

/** The same choice on another base. No badge on an uploaded base is the `file` kind. */
export function withIconBase(icon: AppProfileIconSource, base: string): AppProfileIconSource {
  if (icon.kind === 'none' || icon.kind === 'file') {
    return isBuiltInIconBase(base) ? { kind: 'none', base } : { kind: 'file', path: base }
  }
  const { base: _old, ...rest } = icon
  return base === 'classic' ? rest : { ...rest, base }
}

/** What the chooser asks the main process for: the Profile Manager's calls, or Settings' own. */
export type IconChooserApi = {
  chooseFile: (kind: 'image' | 'file') => Promise<ChosenIconFile>
  preview: (icon: AppProfileIconSource) => Promise<AppProfileReply>
}

export function ProfileIconPicker(props: {
  value: AppProfileIconSource
  onChange: (icon: AppProfileIconSource) => void
  /** The first free badge character. */
  defaultText: string
  /** The file choice. Default: the Profile Manager's. */
  chooseFile?: IconChooserApi['chooseFile']
}): React.JSX.Element {
  const t = useTranslate()
  const chooseFile =
    props.chooseFile ??
    ((kind) => window.api?.appProfiles?.chooseIconFile(kind) ?? Promise.resolve(null))
  const { value, onChange } = props
  const [baseError, setBaseError] = useState<string | null>(null)
  const base = iconBaseOf(value)
  const style =
    value.kind === 'badge' || value.kind === 'image' ? (value.style ?? 'ref-match') : 'ref-match'
  const keepBase = base === 'classic' || base === '' ? {} : { base }
  const chooseBadgeImage = (): void => {
    void chooseFile('image').then((path) => {
      if (typeof path === 'string') {
        onChange({ kind: 'image', path, style, ...keepBase })
      }
    })
  }
  const chooseBase = (): void => {
    void chooseFile('file').then((path) => {
      // Upstream's custom icon import refused it (not square, too small, ...).
      setBaseError(path && typeof path === 'object' ? importFailureText(t, path.code) : null)
      if (typeof path === 'string') {
        onChange(withIconBase(value, path))
      }
    })
  }

  return (
    // p-1 keeps the focus and selection rings inside the scroll box.
    <div className={`scrollbar-sleek flex flex-col gap-3 overflow-y-auto p-1 ${ICON_PICKER_SIZE}`}>
      <BaseIcons
        base={base}
        onChange={(next) => {
          setBaseError(null)
          onChange(withIconBase(value, next))
        }}
        choose={chooseBase}
      />
      {baseError ? (
        <p role="alert" className="text-xs text-destructive">
          {baseError}
        </p>
      ) : null}
      <Label id="profile-icon-mode" className="font-semibold">
        {t('profileManager.icon.label', 'Badge')}
      </Label>
      <ToggleGroup
        type="single"
        variant="segmented-card"
        className="grid-cols-3"
        aria-labelledby="profile-icon-mode"
        value={value.kind === 'file' ? 'none' : value.kind}
        onValueChange={(kind) => {
          if (kind === 'badge') {
            onChange({ kind, text: props.defaultText, style, ...keepBase })
          } else if (kind === 'image') {
            onChange({ kind, path: '', style, ...keepBase })
          } else if (kind === 'none') {
            onChange(withIconBase({ kind: 'none', base: 'classic' }, base || 'classic'))
          }
        }}
      >
        <ToggleGroupItem value="none">
          {t('profileManager.icon.modeNone', 'No badge')}
        </ToggleGroupItem>
        <ToggleGroupItem value="badge">
          {t('profileManager.icon.modeBadge', 'Badge character')}
        </ToggleGroupItem>
        <ToggleGroupItem value="image">
          {t('profileManager.icon.modeImage', 'Badge image')}
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
                'Default: the first letter of the app name, or a number when another profile uses it. A letter or an emoji also works.'
              )}
              onChange={(text) => onChange({ ...value, text })}
            />
          </div>
          <BadgeColors
            color={value.color}
            onChange={(color) => {
              // The default colour is no color key, as the saved icon has it.
              const { color: _old, ...rest } = value
              onChange(color ? { ...rest, color } : rest)
            }}
          />
        </div>
      ) : value.kind === 'image' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={chooseBadgeImage}>
            {t('profileManager.icon.chooseImage', 'Choose a badge image…')}
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {value.path
              ? fileName(value.path)
              : t(
                  'profileManager.icon.imageNote',
                  'PNG, JPEG, WebP, SVG or ICNS. Orca puts it in the corner.'
                )}
          </span>
        </div>
      ) : null}
      {value.kind === 'badge' || value.kind === 'image' ? (
        <ProfileStyleGrid style={style} onChange={(next) => onChange({ ...value, style: next })} />
      ) : null}
    </div>
  )
}

// The CLI takes seconds for a preview: a quick series of changes (typing, a colour drag) makes one.
const PREVIEW_DELAY_MS = 300

// The menu-bar template is black: macOS shows it as it is on a light menu bar, white on a dark one.
const dockSamples = [
  {
    key: 'light',
    sample: 'bg-gradient-to-b from-[#e8ecf2] to-[#cfd6e0]',
    dock: 'border-white/80 bg-white/55',
    menuBar: 'bg-white/70',
    template: ''
  },
  {
    key: 'dark',
    sample: 'bg-gradient-to-b from-[#1f2937] to-[#0b1220]',
    dock: 'border-white/15 bg-white/10',
    menuBar: 'bg-black/45',
    template: 'invert'
  }
]

/**
 * The preview of the icon on a light and on a dark Dock, and of its menu-bar template on a light
 * and on a dark menu bar, as the main process makes them.
 */
export function ProfileIconPreview(props: {
  value: AppProfileIconSource
  /** The profile that the Edit dialog changes; its own badge character is free. */
  profileId?: string | null
  /** Save runs: no new preview starts, and the last one stays. */
  busy?: boolean
  /** The preview call, a stable function: a new one starts a new preview. Default: the Profile
   * Manager's, for `profileId`. */
  preview?: IconChooserApi['preview']
}): React.JSX.Element {
  const t = useTranslate()
  const profiles = window.api?.appProfiles
  const custom = props.preview
  const [preview, setPreview] = useState<
    { png: string; menuBarPng?: string } | { error: string } | null
  >(null)
  const key = JSON.stringify(props.value)
  const ready = iconChoiceReady(props.value)

  useEffect(() => {
    const run =
      custom ??
      (profiles
        ? (icon: AppProfileIconSource) => profiles.iconPreview(icon, props.profileId)
        : null)
    if (!run || !ready) {
      setPreview(null)
      return
    }
    if (props.busy) {
      return
    }
    let current = true
    setPreview(null)
    const timer = setTimeout(() => {
      void run(JSON.parse(key) as AppProfileIconSource).then((reply) => {
        if (current) {
          setPreview(
            reply.ok
              ? (reply.result as { png: string; menuBarPng?: string })
              : { error: reply.error.message }
          )
        }
      })
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [custom, profiles, key, ready, props.profileId, props.busy])

  return (
    <aside
      aria-label={t('profileManager.icon.preview', 'Preview')}
      className={`flex flex-col gap-3.5 ${ICON_PREVIEW_WIDTH}`}
    >
      <span className="font-semibold">{t('profileManager.icon.preview', 'Preview')}</span>
      {dockSamples.map((sample, index) => (
        <div
          key={sample.key}
          className={`flex items-center justify-center gap-4 rounded-[14px] p-5 ${sample.sample}`}
        >
          <div className={`flex items-end gap-3 rounded-[18px] border px-4 py-2.5 ${sample.dock}`}>
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
          {preview && 'png' in preview && preview.menuBarPng ? (
            <div className={`flex h-7 items-center rounded-md px-2.5 ${sample.menuBar}`}>
              <img
                className={`h-[18px] w-auto ${sample.template}`}
                // The dark sample shows the same image again.
                alt={
                  index === 0
                    ? t('profileManager.icon.menuBarAlt', 'Preview of the menu-bar icon')
                    : ''
                }
                src={`data:image/png;base64,${preview.menuBarPng}`}
              />
            </div>
          ) : null}
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
