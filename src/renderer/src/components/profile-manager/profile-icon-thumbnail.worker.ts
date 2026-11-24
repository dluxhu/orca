// The badge style thumbnail worker. A style takes 0.5 to 8 s, so it never runs on the UI thread.
import { styleThumbnail, type IconParts, type ThumbnailMessage } from './profile-icon-thumbnail'

let parts: IconParts | null = null

self.onmessage = (event: MessageEvent<ThumbnailMessage>): void => {
  if ('parts' in event.data) {
    parts = event.data.parts
    return
  }
  if (!parts) {
    self.postMessage({ error: 'No icon parts.' })
    return
  }
  try {
    const img = styleThumbnail(parts, event.data.style)
    self.postMessage({ img }, { transfer: [img.data.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
