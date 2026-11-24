import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { profileManagerSmoke } from './profile-manager-smoke'

function fakeWindow(
  rendered: () => boolean,
  url = 'file:///A.app/Contents/Resources/app.asar/out/renderer/profile-manager.html#'
) {
  const contents = Object.assign(new EventEmitter(), {
    executeJavaScript: async () => rendered(),
    getURL: () => url
  })
  return { window: { webContents: contents } as never, contents }
}

describe('profileManagerSmoke', () => {
  it('passes when the page shows its heading', async () => {
    let polls = 0
    const { window } = fakeWindow(() => ++polls > 2)
    await expect(profileManagerSmoke(window, 1000, 1)).resolves.toBeNull()
  })

  it('fails on a renderer console error, a gone renderer or a failed load', async () => {
    for (const fire of [
      (c: EventEmitter) => c.emit('console-message', { level: 'error', message: 'boom' }),
      (c: EventEmitter) => c.emit('render-process-gone', {}, { reason: 'crashed' }),
      (c: EventEmitter) => c.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND')
    ]) {
      const { window, contents } = fakeWindow(() => false)
      const result = profileManagerSmoke(window, 1000, 1)
      fire(contents)
      expect(await result).toMatch(/boom|crashed|ERR_FILE_NOT_FOUND/)
    }
  })

  it('fails on another page, even with a heading', async () => {
    const { window } = fakeWindow(() => true, 'about:blank')
    await expect(profileManagerSmoke(window, 20, 1)).resolves.toBe(
      'no heading after 20 ms (about:blank)'
    )
  })

  it('fails when the heading never shows, and names the page', async () => {
    const { window } = fakeWindow(() => false, 'about:blank')
    await expect(profileManagerSmoke(window, 20, 1)).resolves.toBe(
      'no heading after 20 ms (about:blank)'
    )
  })
})
