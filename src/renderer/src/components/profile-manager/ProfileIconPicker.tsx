// The icon part of the New and Edit profile forms: docs/fork/profiles-design.md, section 8.
// The main process makes the preview; this view only shows its PNG.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate } from '@/i18n/use-translate'
import type { IconStyle } from '../../../../shared/icon-badger/badger'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import type { AppProfileIcon } from '../../../../shared/app-profiles/app-profile-paths'
import { Field } from './ProfileField'

const STYLES: IconStyle[] = ['ref-match', 'ref-match-bigger']

/** True when the choice is complete: a badge character, or a chosen file. */
export function iconChoiceReady(icon: AppProfileIconSource): boolean {
  return icon.kind === 'badge' ? Boolean(icon.text?.trim()) : Boolean(icon.path)
}

/**
 * The first choice of a form: the profile's own badge, else a new badge. An uploaded image or icon
 * has no path in the registry.
 */
export function editIcon(
  icon: AppProfileIcon | undefined,
  defaultText: string
): AppProfileIconSource {
  return icon?.kind === 'badge'
    ? { kind: 'badge', text: icon.text, style: icon.style }
    : { kind: 'badge', text: defaultText, style: 'ref-match' }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function ProfileIconPicker(props: {
  value: AppProfileIconSource
  onChange: (icon: AppProfileIconSource) => void
  /** The first free badge character. */
  defaultText: string
  /** The profile that the Edit form changes; its own badge character is free. */
  profileId?: string | null
}): React.JSX.Element {
  const t = useTranslate()
  const api = window.api.appProfiles
  const { value, onChange } = props
  const [preview, setPreview] = useState<{ png: string } | { error: string } | null>(null)
  const key = JSON.stringify(value)
  const ready = iconChoiceReady(value)

  useEffect(() => {
    if (!api || !ready) {
      setPreview(null)
      return
    }
    let current = true
    setPreview(null)
    void api.iconPreview(JSON.parse(key) as AppProfileIconSource, props.profileId).then((reply) => {
      if (current) {
        setPreview(
          reply.ok ? { png: (reply.result as { png: string }).png } : { error: reply.error.message }
        )
      }
    })
    return () => {
      current = false
    }
  }, [api, key, ready, props.profileId])

  const style = value.kind === 'file' ? undefined : (value.style ?? 'ref-match')
  const choose = (kind: 'image' | 'file'): void => {
    void api?.chooseIconFile(kind).then((path) => {
      if (path) {
        onChange(kind === 'image' ? { kind, path, style } : { kind, path })
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Label id="profile-icon-mode">{t('profileManager.icon.label', 'Icon')}</Label>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
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
          <Field
            name="badge"
            label={t('profileManager.icon.badge', 'Badge character')}
            value={value.text ?? ''}
            note={t('profileManager.icon.badgeNote', 'One letter, digit or emoji.')}
            onChange={(text) => onChange({ ...value, text })}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => choose(value.kind)}>
              {value.kind === 'image'
                ? t('profileManager.icon.chooseImage', 'Choose a badge image…')
                : t('profileManager.icon.chooseFile', 'Choose an icon file…')}
            </Button>
            <span className="truncate text-xs text-muted-foreground">
              {value.path
                ? fileName(value.path)
                : value.kind === 'image'
                  ? t('profileManager.icon.imageNote', 'PNG, JPEG, WebP, SVG or ICNS.')
                  : t('profileManager.icon.fileNote', 'ICNS or PNG, used as it is.')}
            </span>
          </div>
        )}
        {style ? (
          <>
            <Label id="profile-icon-style">{t('profileManager.icon.style', 'Badge style')}</Label>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              aria-labelledby="profile-icon-style"
              value={style}
              onValueChange={(next) => {
                if (value.kind !== 'file' && (STYLES as string[]).includes(next)) {
                  onChange({ ...value, style: next as IconStyle })
                }
              }}
            >
              <ToggleGroupItem value="ref-match">
                {t('profileManager.icon.styleRefMatch', 'Page curl')}
              </ToggleGroupItem>
              <ToggleGroupItem value="ref-match-bigger">
                {t('profileManager.icon.styleRefMatchBigger', 'Page curl, bigger')}
              </ToggleGroupItem>
            </ToggleGroup>
          </>
        ) : null}
      </div>
      <figure className="flex w-40 flex-col items-center gap-2">
        {preview && 'png' in preview ? (
          <img
            className="size-32"
            alt={t('profileManager.icon.previewAlt', 'Preview of the icon')}
            src={`data:image/png;base64,${preview.png}`}
          />
        ) : (
          <div className="flex size-32 items-center justify-center rounded-lg border text-center text-xs text-muted-foreground">
            {ready ? t('profileManager.icon.making', 'Making the preview…') : null}
          </div>
        )}
        {preview && 'error' in preview ? (
          <p role="alert" className="text-xs text-destructive">
            {preview.error}
          </p>
        ) : null}
        <figcaption className="text-xs text-muted-foreground">
          {t('profileManager.icon.preview', 'Preview')}
        </figcaption>
      </figure>
    </div>
  )
}
