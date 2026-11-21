import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNetRequestFetchAdapter } from '../testing/updater-net-request.fixture'
import { getReleaseRepoForChannel } from '../../../shared/release-channel'

// Fork patch dlux/fork-release-channel: the stable app never sees a Nightly build.
const { netFetchMock, netRequestMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  netRequestMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: netRequestMock }
}))

const ORIGINAL_PLATFORM = process.platform
const RELEASES = `https://github.com/${getReleaseRepoForChannel('stable')}/releases`
const NIGHTLY = [
  'v1.4.268-daily.202611201835-dlux.3',
  'v1.4.265-daily.202611191836-dlux.2',
  'v1.4.264-daily.202611181832-dlux.1'
]

function manifest(tag: string): string {
  const version = tag.replace(/^v/, '')
  return [`version: ${version}`, 'files:', `  - url: orca-${version}-arm64-mac.zip`].join('\n')
}

function respond(atomTags: string[], latestTag: string | null = null): void {
  netFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === `${RELEASES}.atom`) {
      const entries = atomTags
        .map((tag) => `<entry><link href="${RELEASES}/tag/${tag}"/></entry>`)
        .join('')
      return Promise.resolve({ ok: true, text: () => Promise.resolve(`<feed>${entries}</feed>`) })
    }
    if (url === `${RELEASES}/latest` && latestTag) {
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: { get: () => `${RELEASES}/tag/${latestTag}` }
      })
    }
    const manifestMatch = url.match(/\/releases\/download\/([^/]+)\/latest-mac\.yml$/)
    if (manifestMatch) {
      const tag = decodeURIComponent(manifestMatch[1])
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(manifest(tag)) })
    }
    if (init?.method === 'HEAD' && url.startsWith(`${RELEASES}/download/`)) {
      return Promise.resolve({ ok: true, status: 200 })
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
  })
}

describe('fork release feed', () => {
  beforeEach(() => {
    vi.resetModules()
    netFetchMock.mockReset()
    netRequestMock.mockReset()
    installNetRequestFetchAdapter(netRequestMock, netFetchMock)
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM })
  })

  it('offers the next stable build, not a newer nightly with a ready manifest', async () => {
    respond([...NIGHTLY, 'v1.4.259-dlux.8', 'v1.4.259-dlux.7'])
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

    expect(
      await fetchNewerReleaseTagsWithReadiness('1.4.259-dlux.7', 2, { includePrerelease: true })
    ).toEqual({ tags: ['v1.4.259-dlux.8', 'v1.4.259-dlux.7'], state: 'ready' })
  })

  it('finds no newer build when only nightlies are in the feed', async () => {
    respond(NIGHTLY)
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

    expect(
      await fetchNewerReleaseTagsWithReadiness('1.4.259-dlux.7', 2, { includePrerelease: true })
    ).toEqual({ tags: [], state: 'no-newer' })
  })

  it('gives the Nightly app the fixed nightly feed, with no update delay', async () => {
    respond([...NIGHTLY, 'v1.4.259-dlux.8'])
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')
    const { getReleaseDownloadUrl } = await import('./updater-release-readiness')

    const result = await fetchNewerReleaseTagsWithReadiness(NIGHTLY[1].slice(1), 2, {
      includePrerelease: true,
      minReleaseAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: Date.parse('2026-11-21T00:00:00Z')
    })
    expect(result).toMatchObject({ tags: ['nightly'], state: 'ready' })
    expect(result.releaseDelay?.heldRelease).toBeNull()
    expect(result.releaseDelay?.isTagOldEnough('nightly')).toBe(true)
    expect(netFetchMock).not.toHaveBeenCalled()
    expect(getReleaseDownloadUrl('nightly')).toBe(`${RELEASES}/download/nightly`)
  })

  it('accepts a stable fork version from /releases/latest', async () => {
    respond(NIGHTLY, 'v1.4.259-dlux.8')
    const { fetchLatestStableReleaseTag } = await import('./updater-prerelease-feed')

    expect(await fetchLatestStableReleaseTag()).toBe('v1.4.259-dlux.8')
  })

  it('refuses a nightly from /releases/latest', async () => {
    respond(NIGHTLY, NIGHTLY[0])
    const { fetchLatestStableReleaseTag } = await import('./updater-prerelease-feed')

    expect(await fetchLatestStableReleaseTag()).toBeNull()
  })
})
