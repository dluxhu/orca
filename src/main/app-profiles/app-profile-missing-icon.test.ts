import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profile: null as { id: string } | null,
  own: null as object | null,
  runCli: vi.fn(),
  forget: vi.fn(),
  applyAppIcon: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('../window/desktop-integration/app-icon', () => ({ applyAppIcon: h.applyAppIcon }))
vi.mock('../tray/system-tray', () => ({ refreshMacMenuBarImage: h.refresh }))
vi.mock('./app-profile', () => ({ getAppProfile: () => h.profile }))
vi.mock('./app-profile-dock-icon', () => ({
  ownDockIcon: () => h.own,
  forgetOwnDockIcon: h.forget
}))
vi.mock('./profile-manager-cli', () => ({ runCli: h.runCli }))

import { makeMissingProfileIcon } from './app-profile-missing-icon'

beforeEach(() => {
  h.profile = { id: 'work' }
  h.own = null
  h.runCli.mockReset().mockResolvedValue({ ok: true, result: {} })
  for (const mock of [h.forget, h.applyAppIcon, h.refresh]) {
    mock.mockReset()
  }
})

describe('makeMissingProfileIcon', () => {
  it('asks the CLI for the icon of a profile without a kept icon, then shows it', async () => {
    makeMissingProfileIcon(() => 'classic')
    expect(h.runCli).toHaveBeenCalledWith([
      'profiles',
      'set-icon',
      'work',
      '--if-missing',
      '--json'
    ])
    // The start does not wait for the CLI.
    expect(h.applyAppIcon).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(h.applyAppIcon).toHaveBeenCalledWith('classic'))
    expect(h.forget).toHaveBeenCalledTimes(1)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing in the default app and in a profile with a kept icon', () => {
    h.profile = null
    makeMissingProfileIcon(() => 'classic')
    h.profile = { id: 'work' }
    h.own = {}
    makeMissingProfileIcon(() => 'classic')
    expect(h.runCli).not.toHaveBeenCalled()
  })

  it('keeps the icon as it is when the CLI fails', async () => {
    h.runCli.mockResolvedValue({ ok: false, error: { message: 'no' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeMissingProfileIcon(() => 'classic')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
    expect(h.applyAppIcon).not.toHaveBeenCalled()
    expect(h.forget).not.toHaveBeenCalled()
  })
})
