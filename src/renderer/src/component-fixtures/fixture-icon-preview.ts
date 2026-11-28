// The icon preview of the icon chooser fixtures: a style thumbnail. A live preview takes the CLI.
import stickerUrl from '../assets/profile-icon-styles/sticker.png?url'

/** The preview reply: a PNG that the fixture has, as base64. */
export async function fixturePreview(): Promise<{ ok: true; result: { png: string } }> {
  const bytes = new Uint8Array(await (await fetch(stickerUrl)).arrayBuffer())
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return { ok: true, result: { png: btoa(text) } }
}
