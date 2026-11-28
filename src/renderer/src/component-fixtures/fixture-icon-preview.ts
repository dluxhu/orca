// The icon preview of the icon chooser fixtures: a built-in icon for no badge, else a style
// thumbnail with a badge. A live preview takes the CLI.
import stickerUrl from '../assets/profile-icon-styles/sticker.png?url'
import watercolorUrl from '../../../../resources/app-icons/orca-watercolor.png?url'
import blueUrl from '../../../../resources/app-icons/orca-blue.png?url'
import classicUrl from '../../../../resources/icon.png?url'
import type { AppProfileIconSource } from '../../../shared/app-profiles/app-profile-rules'

/** The preview reply: a PNG that the fixture has, as base64. */
export async function fixturePreview(
  icon: AppProfileIconSource
): Promise<{ ok: true; result: { png: string } }> {
  const url =
    icon.kind === 'none'
      ? { classic: classicUrl, watercolor: watercolorUrl, blue: blueUrl }[icon.base]
      : icon.kind === 'file'
        ? classicUrl
        : stickerUrl
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return { ok: true, result: { png: btoa(text) } }
}

/** The fixture interact step: the preview comes 300 ms after the first paint. */
export const waitForPreview = (): Promise<void> => new Promise((done) => setTimeout(done, 1000))
