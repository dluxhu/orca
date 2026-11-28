import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  relaunch: vi.fn(),
  exit: vi.fn(),
  showErrorBox: vi.fn(),
  spawn: vi.fn(() => ({ unref: () => {} }))
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<object>()),
  spawn: h.spawn
}))
vi.mock('electron', () => ({
  app: { relaunch: h.relaunch, exit: h.exit },
  dialog: { showErrorBox: h.showErrorBox }
}))
vi.mock('../../cli/app-profiles/app-profile-create', () => ({
  defaultAppOf: () => '/Applications/Orca.app',
  runTool: () => ''
}))

import { noteOutdatedServingProfileApp, refreshOutdatedProfileApp } from './app-profile-refresh'

beforeEach(() => {
  for (const mock of Object.values(h)) {
    mock.mockClear()
  }
})

describe('refreshOutdatedProfileApp', () => {
  it('starts as it is when the runtime has the default app version', () => {
    const refresh = vi.fn(() => false)
    expect(refreshOutdatedProfileApp('/data/work', false, { refresh, startAgain: vi.fn() })).toBe(
      false
    )
    expect(refresh).toHaveBeenCalledWith(
      expect.any(String),
      '/Applications/Orca.app',
      expect.any(Function),
      { checkFile: '/data/work/profile-runtime-check.txt', userDataPath: '/data/work' }
    )
    expect(h.relaunch).not.toHaveBeenCalled()
  })

  it('starts the new bundle with open after this process exits, not with app.relaunch', () => {
    expect(refreshOutdatedProfileApp('/data/work', false, { refresh: () => true })).toBe(true)
    expect(h.exit).toHaveBeenCalledWith(0)
    expect(h.relaunch).not.toHaveBeenCalled()
    const [program, args, options] = h.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { detached: boolean }
    ]
    expect(program).toBe('/bin/sh')
    expect(args[1]).toBe(
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open -n "$0"'
    )
    // $0: the bundle of this process; $1: its pid.
    expect(args.slice(2)).toEqual([expect.stringMatching(/[^/]$/), String(process.pid)])
    expect(options.detached).toBe(true)
  })

  it('names a failed refresh and starts with the old runtime', () => {
    const refresh = () => {
      throw new Error('Orca could not update the profile app /a/Work.app: codesign failed')
    }
    expect(refreshOutdatedProfileApp('/data/work', false, { refresh, startAgain: vi.fn() })).toBe(
      false
    )
    expect(h.showErrorBox).toHaveBeenCalledWith(
      'Orca could not update this profile app',
      expect.stringContaining('codesign failed')
    )
    expect(h.relaunch).not.toHaveBeenCalled()
  })
})

describe('noteOutdatedServingProfileApp', () => {
  it('logs an out-of-date profile app and only checks: no rebuild, no exit, no new start', () => {
    const refresh = vi.fn(() => true)
    const log = vi.fn()
    expect(noteOutdatedServingProfileApp('/data/work', { refresh, log })).toBe(true)
    expect(refresh).toHaveBeenCalledWith(
      expect.any(String),
      '/Applications/Orca.app',
      expect.any(Function),
      {
        checkFile: '/data/work/profile-runtime-check.txt',
        userDataPath: '/data/work',
        checkOnly: true
      }
    )
    expect(log).toHaveBeenCalledWith(expect.stringContaining('open the profile app once'))
    expect(h.exit).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
    expect(h.showErrorBox).not.toHaveBeenCalled()
  })

  it('is what a serve start runs: it never exits or starts again', () => {
    const refresh = vi.fn(() => true)
    const startAgain = vi.fn()
    expect(refreshOutdatedProfileApp('/data/work', true, { refresh, startAgain })).toBe(false)
    expect(refresh).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ checkOnly: true })
    )
    expect(startAgain).not.toHaveBeenCalled()
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('stays quiet with the same template key', () => {
    const log = vi.fn()
    expect(noteOutdatedServingProfileApp('/data/work', { refresh: () => false, log })).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('logs a failed check instead of a dialog, and serves on', () => {
    const log = vi.fn()
    const refresh = () => {
      throw new Error('/x is not a profile app.')
    }
    expect(noteOutdatedServingProfileApp('/data/work', { refresh, log })).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not a profile app'))
    expect(h.showErrorBox).not.toHaveBeenCalled()
  })
})
