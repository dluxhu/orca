// The parts of the icon chooser (ProfileIconPicker): the base icons and the badge colours.
import { ImageUp, Plus } from 'lucide-react'
import classicIconUrl from '../../../../../resources/icon.png?url'
import watercolorIconUrl from '../../../../../resources/app-icons/orca-watercolor.png?url'
import blueIconUrl from '../../../../../resources/app-icons/orca-blue.png?url'
import { ColorPicker } from '@/components/ui/color-picker'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  APP_PROFILE_ICON_BASES,
  isBuiltInIconBase
} from '../../../../shared/app-profiles/app-profile-rules'
import {
  APP_PROFILE_BADGE_COLOR,
  APP_PROFILE_BADGE_SWATCHES
} from '../../../../shared/app-profiles/app-profile-icon-files'

type BuiltInBase = (typeof APP_PROFILE_ICON_BASES)[number]

export function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

const BASE_URLS = {
  classic: classicIconUrl,
  watercolor: watercolorIconUrl,
  blue: blueIconUrl
} satisfies Record<BuiltInBase, string>

/** The badge character colour: the swatches, then any colour. The default colour is no colour. */
export function BadgeColors(props: {
  color?: string
  onChange: (color: string | undefined) => void
}): React.JSX.Element {
  const t = useTranslate()
  const current = props.color ?? APP_PROFILE_BADGE_COLOR
  const isCustom = !APP_PROFILE_BADGE_SWATCHES.some((swatch) => swatch === current)
  const names: Record<(typeof APP_PROFILE_BADGE_SWATCHES)[number], string> = {
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
        {APP_PROFILE_BADGE_SWATCHES.map((swatch) => (
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
              aria-pressed={isCustom}
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

/** The base icon choice: the built-in icons, and an uploaded image. */
export function BaseIcons(props: {
  base: string
  onChange: (base: string) => void
  choose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const names: Record<BuiltInBase, string> = {
    classic: t('profileManager.icon.baseClassic', 'Classic'),
    watercolor: t('profileManager.icon.baseWatercolor', 'Watercolor'),
    blue: t('profileManager.icon.baseBlue', 'Blue')
  }
  const uploaded = !isBuiltInIconBase(props.base)
  const tile =
    'h-auto min-w-0 flex-col gap-1.5 rounded-[10px] px-1 py-2.5 text-[11px] leading-tight whitespace-normal data-[state=on]:border-foreground'
  return (
    <div className="flex flex-col gap-1.5">
      <Label id="profile-icon-base" className="font-semibold">
        {t('profileManager.icon.base', 'Base icon')}
      </Label>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={2}
        className="grid w-full grid-cols-4"
        aria-labelledby="profile-icon-base"
        value={uploaded ? 'upload' : props.base}
        onValueChange={(next) => {
          if (isBuiltInIconBase(next)) {
            props.onChange(next)
          }
        }}
      >
        {APP_PROFILE_ICON_BASES.map((id) => (
          <ToggleGroupItem key={id} value={id} className={tile}>
            <img src={BASE_URLS[id]} alt="" className="size-12 object-contain" />
            {names[id]}
          </ToggleGroupItem>
        ))}
        {/* A click chooses a file each time, also when an uploaded base is on. */}
        <ToggleGroupItem value="upload" className={tile} onClick={props.choose}>
          <ImageUp aria-hidden className="size-12 p-2 text-muted-foreground" />
          {t('profileManager.icon.baseUpload', 'Upload…')}
        </ToggleGroupItem>
      </ToggleGroup>
      {uploaded ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {props.base && !/profile-icon(-base\.png|\.icns)$/.test(props.base)
            ? fileName(props.base)
            : props.base
              ? t('profileManager.icon.baseKept', 'The uploaded image')
              : null}
        </span>
      ) : null}
    </div>
  )
}
