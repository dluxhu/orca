import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {} }))

import { classifyProfileServer, type ProcessRow } from './app-profile-serve-exclusion'

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
