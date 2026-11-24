// The UI side of the thumbnail worker: PNG decode, one style at a time, and stop.
import type { IconStyle } from '../../../../shared/icon-badger/badger'
import type { Img } from '../../../../shared/icon-badger/raster'
import { THUMBNAIL_PX, type IconParts, type ThumbnailMessage } from './profile-icon-thumbnail'

async function decodePng(base64: string): Promise<Img> {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('No 2D canvas.')
  }
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  return {
    width: bitmap.width,
    height: bitmap.height,
    channels: 4,
    data: new Uint8Array(data.buffer)
  }
}

/** The parts from the iconParts IPC reply: base64 PNGs. */
export async function decodeParts(result: { base: string; badge: string }): Promise<IconParts> {
  const [base, badge] = await Promise.all([decodePng(result.base), decodePng(result.badge)])
  return { base, badge }
}

function dataUrl(img: Img): string {
  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_PX
  canvas.height = THUMBNAIL_PX
  // A copy: ImageData takes no view of a shared buffer.
  const pixels = new Uint8ClampedArray(img.data)
  canvas.getContext('2d')?.putImageData(new ImageData(pixels, img.width, img.height), 0, 0)
  return canvas.toDataURL()
}

let worker: Worker | null = null
let workerParts: IconParts | null = null
let pending: { resolve: (url: string) => void; reject: (error: Error) => void } | null = null

/** The thumbnail of one style as a PNG data URL. One request at a time. */
export function renderThumbnail(parts: IconParts, style: IconStyle): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./profile-icon-thumbnail.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (event: MessageEvent<{ img: Img } | { error: string }>) => {
      const request = pending
      pending = null
      if ('img' in event.data) {
        request?.resolve(dataUrl(event.data.img))
      } else {
        request?.reject(new Error(event.data.error))
      }
    }
    workerParts = null
  }
  if (workerParts !== parts) {
    workerParts = parts
    worker.postMessage({ parts } satisfies ThumbnailMessage)
  }
  const current = worker
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    current.postMessage({ style } satisfies ThumbnailMessage)
  })
}

/** Stops the render that runs now. The next request starts a new worker. */
export function stopThumbnails(): void {
  worker?.terminate()
  worker = null
  pending?.reject(new Error('Stopped.'))
  pending = null
}
