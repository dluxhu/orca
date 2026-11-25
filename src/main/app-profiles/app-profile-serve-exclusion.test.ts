import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bootoutStatus: 0,
  unitExists: false,
  spawnSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: () => {} })),
  once: vi.fn(),
  showMessageBoxSync: vi.fn(() => 1)
}))

vi.mock('electron', () => ({
  app: { once: h.once },
  dialog: { showMessageBoxSync: h.showMessageBoxSync, showErrorBox: vi.fn() }
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: h.spawn,
  spawnSync: h.spawnSync
}))
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: () => h.unitExists
}))
vi.mock('../orcad/instance-lock/orcad-instance-lock-record', () => ({
  readOrcadInstanceLockRecord: () => ({ pid: 11, role: 'orcad' })
}))
vi.mock('../daemon/endpoint/identity/daemon-process-inspection', () => ({
  isProcessAlive: () => false
}))

import {
  classifyProfileServer,
  takeProfileFromServer,
  type ProcessRow
} from './app-profile-serve-exclusion'

const record = (pid: number, role: 'orcad' | 'desktop') =>
  ({
    pid,
    role,
    startedAtMs: 0,
    identity: '501',
    version: '1',
    acquiredAt: '',
    nonce: 'n'
  }) as never

const table: ProcessRow[] = [
  { pid: 10, ppid: 1, command: '/App/Contents/MacOS/Orca /App/out/cli/index.js serve --supervise' },
  { pid: 11, ppid: 10, command: '/App/Contents/Resources/orcad/node orcad.js' },
  { pid: 20, ppid: 5, command: '/App/Contents/MacOS/Orca /App/out/cli/index.js serve' },
  { pid: 21, ppid: 20, command: '/Work.app/Contents/MacOS/Orca --user-data-dir=/w --serve' },
  { pid: 30, ppid: 1, command: '/Work.app/Contents/MacOS/Orca' }
]

describe('classifyProfileServer', () => {
  it('finds the service: the supervisor runs under launchd', () => {
    expect(classifyProfileServer(record(11, 'orcad'), table, 99)).toEqual({
      kind: 'service',
      pid: 11
    })
  })

  it('finds a hand-started Electron serve and its supervisor', () => {
    expect(classifyProfileServer(record(21, 'desktop'), table, 99)).toEqual({
      kind: 'hand-started',
      pids: [20, 21]
    })
  })

  it('leaves a desktop app, this process and a dead holder alone', () => {
    expect(classifyProfileServer(record(30, 'desktop'), table, 99)).toEqual({ kind: 'none' })
    expect(classifyProfileServer(record(11, 'orcad'), table, 11)).toEqual({ kind: 'none' })
    expect(classifyProfileServer(record(77, 'orcad'), table, 99)).toEqual({ kind: 'none' })
    expect(classifyProfileServer(null, table, 99)).toEqual({ kind: 'none' })
  })
})

describe('takeProfileFromServer', () => {
  const uid = process.getuid?.() ?? 0
  const bootouts = () =>
    h.spawnSync.mock.calls.filter(
      ([program, args]) => program === '/bin/launchctl' && args[0] === 'bootout'
    )

  beforeEach(() => {
    h.bootoutStatus = 0
    h.unitExists = false
    for (const mock of [h.spawnSync, h.spawn, h.once, h.showMessageBoxSync]) {
      mock.mockClear()
    }
    const ps = table.map((row) => `${row.pid} ${row.ppid} ${row.command}`).join('\n')
    h.spawnSync.mockImplementation((program: string) =>
      program === '/bin/ps' ? { status: 0, stdout: ps } : { status: h.bootoutStatus, stdout: '' }
    )
  })

  it('stops the service job when its LaunchAgent file is absent, and starts nothing at quit', () => {
    expect(takeProfileFromServer('/data/work')).toBe(true)
    expect(bootouts()).toHaveLength(1)
    expect(bootouts()[0][1][1]).toMatch(new RegExp(`^gui/${uid}/`))
    expect(h.showMessageBoxSync).not.toHaveBeenCalled()
    expect(h.once).not.toHaveBeenCalled()
  })

  it('starts the job again from its LaunchAgent file after a normal quit', () => {
    h.unitExists = true
    expect(takeProfileFromServer('/data/work')).toBe(true)
    expect(h.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    h.once.mock.calls[0][1]()
    const [program, args] = h.spawn.mock.calls[0] as unknown as [string, string[]]
    expect([program, args.slice(0, 2)]).toEqual(['/bin/launchctl', ['bootstrap', `gui/${uid}`]])
    expect(args[2]).toMatch(/LaunchAgents\/.+\.plist$/)
  })

  it('asks the user when no job of the profile is loaded', () => {
    h.bootoutStatus = 113
    h.unitExists = true
    expect(takeProfileFromServer('/data/work')).toBe(false)
    expect(h.showMessageBoxSync).toHaveBeenCalledTimes(1)
    expect(h.once).not.toHaveBeenCalled()
  })
})
