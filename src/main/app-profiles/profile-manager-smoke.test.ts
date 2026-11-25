import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { profileManagerSmoke, runProfileManagerSmoke } from './profile-manager-smoke'

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

  it('fails on an error that arrives while the heading query runs', async () => {
    const contents = Object.assign(new EventEmitter(), {
      executeJavaScript: async () => {
        contents.emit('console-message', { level: 'error', message: 'late boom' })
        return true
      },
      getURL: () => 'file:///A.app/Contents/Resources/app.asar/out/renderer/profile-manager.html#'
    })
    await expect(profileManagerSmoke({ webContents: contents } as never, 1000, 1)).resolves.toBe(
      'console error: late boom'
    )
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

  it('runProfileManagerSmoke reports a broken window and a hang, once each', async () => {
    const done = vi.fn()
    runProfileManagerSmoke(() => {
      throw new Error('window broke')
    }, done)
    await vi.waitFor(() =>
      expect(done).toHaveBeenCalledWith('profile-manager-smoke: fail window broke', 1)
    )
    const hang = vi.fn()
    const { window } = fakeWindow(() => false)
    ;(
      window as { webContents: { executeJavaScript: () => Promise<boolean> } }
    ).webContents.executeJavaScript = () => new Promise(() => undefined)
    runProfileManagerSmoke(() => window, hang, 30)
    await vi.waitFor(() =>
      expect(hang).toHaveBeenCalledWith('profile-manager-smoke: fail no result after 30 ms', 1)
    )
    expect(hang).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledTimes(1)
  })
})
