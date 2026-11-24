// The badge style choice: one 48 px thumbnail per style, its name under it.
// See docs/fork/profiles-design.md, section 8.
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate } from '@/i18n/use-translate'
import { ICON_STYLES, type IconStyle } from '../../../../shared/icon-badger/badger'

// Made once with a placeholder badge: profile-style-thumbnails.test.ts. A live render takes seconds.
const THUMBNAILS = import.meta.glob<string>('../../assets/profile-icon-styles/*.png', {
  query: '?url',
  import: 'default',
  eager: true
})

export function ProfileStyleGrid(props: {
  style: IconStyle
  onChange: (style: IconStyle) => void
}): React.JSX.Element {
  const t = useTranslate()
  // A style without a name here shows its id.
  const labels: Partial<Record<string, string>> = {
    'ref-match': t('profileManager.icon.styleRefMatch', 'Page curl'),
    'ref-match-bigger': t('profileManager.icon.styleRefMatchBigger', 'Page curl, bigger'),
    'white-tile': t('profileManager.icon.styleWhiteTile', 'White tile'),
    'tint-tile': t('profileManager.icon.styleTintTile', 'Tint tile'),
    frosted: t('profileManager.icon.styleFrosted', 'Frosted'),
    round: t('profileManager.icon.styleRound', 'Round'),
    stamp: t('profileManager.icon.styleStamp', 'Stamp'),
    sticker: t('profileManager.icon.styleSticker', 'Sticker'),
    'liquid-glass': t('profileManager.icon.styleLiquidGlass', 'Liquid glass'),
    'page-curl': t('profileManager.icon.stylePageCurl', 'Curled page'),
    'page-curl-small': t('profileManager.icon.stylePageCurlSmall', 'Curled page, small'),
    'gentle-curve': t('profileManager.icon.styleGentleCurve', 'Gentle curve'),
    'rolled-cylinder': t('profileManager.icon.styleRolledCylinder', 'Rolled'),
    'round-peel': t('profileManager.icon.styleRoundPeel', 'Round peel')
  }
  return (
    <>
      <span
        id="profile-icon-style"
        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {t('profileManager.icon.style', 'Badge style')}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={2}
        className="grid w-full grid-cols-5"
        aria-labelledby="profile-icon-style"
        value={props.style}
        onValueChange={(next) => {
          if ((ICON_STYLES as readonly string[]).includes(next)) {
            props.onChange(next as IconStyle)
          }
        }}
      >
        {ICON_STYLES.map((id) => (
          <ToggleGroupItem
            key={id}
            value={id}
            title={id}
            className="h-auto min-w-0 flex-col gap-1.5 rounded-[10px] px-1 py-2.5 text-[11px] leading-tight whitespace-normal data-[state=on]:border-foreground"
          >
            <img
              src={THUMBNAILS[`../../assets/profile-icon-styles/${id}.png`]}
              alt=""
              className="size-12"
            />
            {labels[id] ?? id}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </>
  )
}
