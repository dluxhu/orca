import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  relaunch: vi.fn(),
  exit: vi.fn(),
  showErrorBox: vi.fn()
}))
vi.mock('electron', () => ({
  app: { relaunch: h.relaunch, exit: h.exit },
  dialog: { showErrorBox: h.showErrorBox }
}))
vi.mock('../../cli/app-profiles/app-profile-create', () => ({
  defaultAppOf: () => '/Applications/Orca.app',
  runTool: () => ''
}))

import { refreshOutdatedProfileApp } from './app-profile-refresh'

beforeEach(() => {
  for (const mock of Object.values(h)) {
    mock.mockReset()
  }
})

describe('refreshOutdatedProfileApp', () => {
  it('starts as it is when the runtime has the default app version', () => {
    const refresh = vi.fn(() => false)
    expect(refreshOutdatedProfileApp({ refresh })).toBe(false)
    expect(refresh).toHaveBeenCalledWith(
      expect.any(String),
      '/Applications/Orca.app',
      expect.any(Function)
    )
    expect(h.relaunch).not.toHaveBeenCalled()
  })

  it('starts again after a refresh, so the new runtime runs', () => {
    expect(refreshOutdatedProfileApp({ refresh: () => true })).toBe(true)
    expect(h.relaunch).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledWith(0)
  })

  it('names a failed refresh and starts with the old runtime', () => {
    const refresh = () => {
      throw new Error('Orca could not update the profile app /a/Work.app: codesign failed')
    }
    expect(refreshOutdatedProfileApp({ refresh })).toBe(false)
    expect(h.showErrorBox).toHaveBeenCalledWith(
      'Orca could not update this profile app',
      expect.stringContaining('codesign failed')
    )
    expect(h.relaunch).not.toHaveBeenCalled()
  })
})
