// The icon preview of the icon chooser fixtures, a stand-in for the CLI's: the base icon, with the
// badge character in a corner circle, or the sticker thumbnail (an emoji) for a badge image.
import stickerUrl from '../assets/profile-icon-styles/sticker.png?url'
import watercolorUrl from '../../../../resources/app-icons/orca-watercolor.png?url'
import blueUrl from '../../../../resources/app-icons/orca-blue.png?url'
import classicUrl from '../../../../resources/icon.png?url'
import type { AppProfileIconSource } from '../../../shared/app-profiles/app-profile-rules'

const BASE_URLS: Record<string, string> = {
  classic: classicUrl,
  watercolor: watercolorUrl,
  blue: blueUrl
}

/** The preview reply: a PNG drawn in the fixture, as base64. */
export async function fixturePreview(
  icon: AppProfileIconSource
): Promise<{ ok: true; result: { png: string } }> {
  if (icon.kind === 'image') {
    return { ok: true, result: { png: await base64Of(stickerUrl) } }
  }
  const base = icon.kind === 'file' ? undefined : icon.base
  const image = new Image()
  image.src = BASE_URLS[base ?? 'classic'] ?? classicUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0, 256, 256)
  if (icon.kind === 'badge') {
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(184, 184, 52, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = icon.color ?? '#111827'
    context.font = 'bold 64px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(icon.text ?? '', 184, 188)
  }
  return { ok: true, result: { png: canvas.toDataURL('image/png').split(',')[1] } }
}

async function base64Of(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return btoa(text)
}

/** The fixture interact step: the preview comes 300 ms after the first paint. */
export const waitForPreview = (): Promise<void> => new Promise((done) => setTimeout(done, 1000))
