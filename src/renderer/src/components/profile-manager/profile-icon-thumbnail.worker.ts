// The badge style thumbnail worker. A style takes 0.5 to 8 s, so it never runs on the UI thread.
import {
  styleThumbnail,
  type IconParts,
  type ThumbnailMessage,
  type ThumbnailReply
} from './profile-icon-thumbnail'

let parts: IconParts | null = null

self.onmessage = (event: MessageEvent<ThumbnailMessage>): void => {
  if ('parts' in event.data) {
    parts = event.data.parts
    return
  }
  const { id, style } = event.data
  if (!parts) {
    self.postMessage({ id, error: 'No icon parts.' } satisfies ThumbnailReply)
    return
  }
  try {
    const img = styleThumbnail(parts, style)
    self.postMessage({ id, img } satisfies ThumbnailReply, { transfer: [img.data.buffer] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id, error: message } satisfies ThumbnailReply)
  }
}
