import { describe, expect, it } from 'vitest'
import {
  getVersionChannel,
  isChannelSupportedOnPlatform,
  RELEASE_CHANNEL_LABELS,
  RELEASE_CHANNELS,
  requiresManualDevChannelInstall,
  type ReleaseChannel
} from './release-channel'

// Fork patch dlux/fork-release-channel. See docs/fork/PATCHES.md.
describe('fork release channels', () => {
  it('lists only Stable and Nightly', () => {
    expect(RELEASE_CHANNELS).toEqual(['stable', 'daily'])
    expect(RELEASE_CHANNELS.map((channel) => RELEASE_CHANNEL_LABELS[channel])).toEqual([
      'Stable',
      'Nightly'
    ])
  })

  it('reads the channel from a fork version', () => {
    expect(getVersionChannel('1.4.259-dlux.7')).toBe('stable')
    expect(getVersionChannel('v1.4.259-dlux.12')).toBe('stable')
    expect(getVersionChannel('1.4.268-daily.202611201835-dlux.3')).toBe('daily')
    expect(getVersionChannel('v1.4.268-daily.202611201835-dlux.3')).toBe('daily')
    // The fixed feed tag is not a build.
    expect(getVersionChannel('nightly')).toBeNull()
  })

  it('does not offer an upstream channel that a shared profile saved', () => {
    for (const channel of ['rc', 'hourly', 'adhoc'] as const) {
      expect(isChannelSupportedOnPlatform(channel, 'darwin')).toBe(false)
    }
    expect(isChannelSupportedOnPlatform('stable', 'darwin')).toBe(true)
    expect(isChannelSupportedOnPlatform('daily', 'darwin')).toBe(true)
  })

  it('installs in place only a stable build in the stable app', () => {
    const manual = (
      runningChannel: ReleaseChannel | null,
      targetChannel: ReleaseChannel,
      platform: NodeJS.Platform = 'darwin'
    ): boolean => requiresManualDevChannelInstall({ platform, runningChannel, targetChannel })

    expect(manual('stable', 'stable')).toBe(false)
    expect(manual('stable', 'stable', 'win32')).toBe(false)
    // Stable and Nightly are separate apps with their own bundle ids.
    expect(manual('stable', 'daily')).toBe(true)
    expect(manual('daily', 'stable')).toBe(true)
    // The Nightly app updates in place only from its own feed.
    expect(manual('daily', 'daily')).toBe(true)
    expect(manual(null, 'stable')).toBe(true)
  })
})
