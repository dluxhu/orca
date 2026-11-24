// One badge style thumbnail: the core of docs/fork/profiles-design.md, section 8, at 1024 px,
// then a Lanczos resize. The thumbnail worker runs it, off the UI thread.
import { renderBadgedIcon, type IconStyle } from '../../../../shared/icon-badger/badger'
import type { Img } from '../../../../shared/icon-badger/raster'
import { resize } from '../../../../shared/icon-badger/resample'

/** 2x of the 48 px tile. */
export const THUMBNAIL_PX = 96

/** The two 1024 px inputs of a badged icon. */
export type IconParts = { base: Img; badge: Img }

export type ThumbnailMessage = { parts: IconParts } | { style: IconStyle }

export function styleThumbnail(parts: IconParts, style: IconStyle): Img {
  return resize(renderBadgedIcon(parts.base, parts.badge, style), THUMBNAIL_PX, THUMBNAIL_PX)
}
