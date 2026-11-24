// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IconParts } from './profile-icon-thumbnail'

/** A stand-in worker: the test answers its style requests by hand. */
class FakeWorker {
  static all: FakeWorker[] = []
  posted: { style?: string; id?: number }[] = []
  terminated = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(message: { style?: string; id?: number }): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  /** The reply of the worker to the request with `id`. */
  reply(id: number): void {
    const img = { width: 96, height: 96, channels: 4, data: new Uint8Array(96 * 96 * 4) }
    this.onmessage?.({ data: { id, img } })
  }
  lastId(): number {
    return this.posted.findLast((message) => message.style)?.id ?? -1
  }
}
vi.stubGlobal('Worker', FakeWorker)

const { renderThumbnail, stopThumbnails } = await import('./profile-icon-thumbnail-client')

const parts = {} as IconParts
afterEach(() => {
  stopThumbnails()
  FakeWorker.all.length = 0
})

describe('renderThumbnail', () => {
  it('never shows a late result: a new request rejects the old one, and only its own id answers it', async () => {
    const old = renderThumbnail(parts, 'stamp')
    const oldId = FakeWorker.all[0].lastId()
    const next = renderThumbnail(parts, 'round')
    await expect(old).rejects.toThrow('Replaced')
    let done = false
    void next.then(() => (done = true))
    // The worker finishes the old style late.
    FakeWorker.all[0].reply(oldId)
    await Promise.resolve()
    expect(done).toBe(false)
    FakeWorker.all[0].reply(FakeWorker.all[0].lastId())
    await expect(next).resolves.toMatch(/^data:/)
  })

  it('a failed worker rejects its request and stops; a later style starts a new worker', async () => {
    const failed = renderThumbnail(parts, 'stamp')
    FakeWorker.all[0].onerror?.()
    await expect(failed).rejects.toThrow('failed')
    expect(FakeWorker.all[0].terminated).toBe(true)
    const later = renderThumbnail(parts, 'round')
    expect(FakeWorker.all).toHaveLength(2)
    FakeWorker.all[1].reply(FakeWorker.all[1].lastId())
    await expect(later).resolves.toMatch(/^data:/)
  })
})
