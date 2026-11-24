// The badge style thumbnails of the icon picker. The main process gives the two inputs once per
// badge input; the worker renders one style at a time, the selected style first.
import { useEffect, useRef, useState } from 'react'
import { ICON_STYLES, type IconStyle } from '../../../../shared/icon-badger/badger'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import type { IconParts } from './profile-icon-thumbnail'
import { decodeParts, renderThumbnail, stopThumbnails } from './profile-icon-thumbnail-client'

type Thumbnails = Partial<Record<IconStyle, string>>

// By badge input. A reopened dialog shows the done thumbnails at once.
const done = new Map<string, Thumbnails>()
// Only the last input: the decoded parts are 8 MB.
let parts: { key: string; request: Promise<IconParts> } | null = null

/** The badge input of a source, without the style. Null for an own icon file, which has no badge. */
function badgeInput(source: AppProfileIconSource): string | null {
  if (source.kind === 'file') {
    return null
  }
  const input = source.kind === 'badge' ? source.text?.trim() : source.path
  return input ? JSON.stringify([source.kind, input]) : null
}

export function useStyleThumbnails(source: AppProfileIconSource, selected: IconStyle): Thumbnails {
  const key = badgeInput(source)
  const reusable = source.kind === 'badge'
  const [thumbnails, setThumbnails] = useState<Thumbnails>({})
  const first = useRef(selected)
  const sourceRef = useRef(source)
  useEffect(() => {
    first.current = selected
    sourceRef.current = source
  })

  useEffect(() => {
    const api = window.api.appProfiles
    if (!key || !api) {
      setThumbnails({})
      return
    }
    const cached = done.get(key) ?? {}
    done.set(key, cached)
    setThumbnails({ ...cached })
    let current = true
    void (async () => {
      if (parts?.key !== key) {
        const request = api.iconParts(sourceRef.current).then((reply) => {
          if (!reply.ok) {
            throw new Error(reply.error.message)
          }
          return decodeParts(reply.result as { base: string; badge: string })
        })
        parts = { key, request }
        // A failed read is tried again on the next open.
        request.catch(() => {
          if (parts?.request === request) {
            parts = null
          }
        })
      }
      const input = await parts.request
      const order = [first.current, ...ICON_STYLES.filter((style) => style !== first.current)]
      for (const style of order) {
        if (!current) {
          return
        }
        if (!cached[style]) {
          cached[style] = await renderThumbnail(input, style)
          if (current) {
            setThumbnails({ ...cached })
          }
        }
      }
    })().catch(() => {
      // A stopped render, or no parts: the tiles keep their placeholder.
    })
    return () => {
      // A new badge input or a closed dialog drops the work for this input at once.
      current = false
      stopThumbnails()
      // An image file can change at the same path (set-icon writes the kept badge again), so
      // only a badge character keeps its thumbnails and parts for the next open.
      if (!reusable) {
        done.delete(key)
        if (parts?.key === key) {
          parts = null
        }
      }
    }
  }, [key, reusable])

  return thumbnails
}
