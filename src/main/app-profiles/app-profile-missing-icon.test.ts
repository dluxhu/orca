import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profile: null as { id: string } | null,
  own: null as object | null,
  runCli: vi.fn(),
  forget: vi.fn()
}))
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
  h.forget.mockReset()
})

describe('makeMissingProfileIcon', () => {
  it('asks the CLI for the icon of a profile without a kept icon, then shows it', async () => {
    const apply = vi.fn()
    makeMissingProfileIcon(apply)
    expect(h.runCli).toHaveBeenCalledWith([
      'profiles',
      'set-icon',
      'work',
      '--if-missing',
      '--json'
    ])
    // The start does not wait for the CLI.
    expect(apply).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(h.forget).toHaveBeenCalledTimes(1)
  })

  it('does nothing in the default app and in a profile with a kept icon', () => {
    h.profile = null
    makeMissingProfileIcon(vi.fn())
    h.profile = { id: 'work' }
    h.own = {}
    makeMissingProfileIcon(vi.fn())
    expect(h.runCli).not.toHaveBeenCalled()
  })

  it('keeps the icon as it is when the CLI fails', async () => {
    h.runCli.mockResolvedValue({ ok: false, error: { message: 'no' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const apply = vi.fn()
    makeMissingProfileIcon(apply)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
    expect(apply).not.toHaveBeenCalled()
    expect(h.forget).not.toHaveBeenCalled()
  })
})
