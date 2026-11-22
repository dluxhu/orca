import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fork patch dlux/fork-release-channel: each fork channel lists its own builds.
const { netFetchMock } = vi.hoisted(() => ({ netFetchMock: vi.fn() }))

vi.mock('electron', () => ({ net: { fetch: netFetchMock } }))
vi.mock('./updater-release-api-token', () => ({
  resolveReleaseApiToken: async () => null,
  rejectReleaseApiToken: () => {}
}))

const NIGHTLY_TAG = 'v1.4.268-daily.202611201835-dlux.3'
const STABLE_TAG = 'v1.4.259-dlux.7'
// The asset names of the published fork releases.
const RELEASES = [
  {
    tag_name: NIGHTLY_TAG,
    prerelease: true,
    assets: [
      { name: 'orca-nightly-1.4.268-daily.202611201835-dlux.3-arm64-mac.zip' },
      { name: 'orca-nightly-macos-arm64.dmg' }
    ]
  },
  { tag_name: 'nightly', prerelease: true, assets: [{ name: 'latest-mac.yml' }] },
  {
    tag_name: STABLE_TAG,
    assets: [
      { name: 'latest-mac.yml' },
      { name: 'orca-1.4.259-dlux.7-arm64-mac.zip' },
      { name: 'orca-macos-arm64.dmg' }
    ]
  }
]

describe('fork release build lists', () => {
  beforeEach(() => {
    vi.resetModules()
    netFetchMock.mockReset()
    netFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => RELEASES })
  })

  it('lists only stable fork builds on Stable', async () => {
    const { listReleaseBuilds } = await import('./updater-release-builds')
    const builds = await listReleaseBuilds('stable', 'darwin')
    expect(builds.map((build) => build.tag)).toEqual([STABLE_TAG])
  })

  it('lists Nightly builds by their installer', async () => {
    const { listReleaseBuilds } = await import('./updater-release-builds')
    const builds = await listReleaseBuilds('daily', 'darwin')
    expect(builds.map((build) => build.tag)).toEqual([NIGHTLY_TAG])
    expect(builds[0].installerUrl).toMatch(
      new RegExp(
        `/releases/download/${encodeURIComponent(NIGHTLY_TAG)}/orca-nightly-macos-arm64\\.dmg$`
      )
    )
  })
})
