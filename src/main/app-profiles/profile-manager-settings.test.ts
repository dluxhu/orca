import { describe, expect, it, vi } from 'vitest'
import type { AppProfileRow } from '../../shared/app-profiles/app-profile-rules'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))
vi.mock('./profile-manager-window', () => ({ isProfileManagerRenderer: () => false }))

import { ownAppProfile } from './profile-manager-settings'

const row = (id: string, state: AppProfileRow['state'], port: number): AppProfileRow => ({
  id,
  name: id,
  appPath: `/apps/${id}.app`,
  userDataPath: `/data/${id}`,
  port,
  state,
  startAtLogin: false
})

describe('ownAppProfile', () => {
  it('keeps the port editable while only this app runs, and not while a server runs', () => {
    const rows = [row('default', 'stopped', 6769), row('work', 'running', 6768)]
    expect(ownAppProfile({ rows, currentId: 'work', keptIds: [] })).toEqual({
      id: 'work',
      enabled: false,
      port: 6768,
      otherPorts: [],
      defaultPort: 6769,
      serverRuns: false
    })
    rows[1] = row('work', 'background', 6768)
    expect(ownAppProfile({ rows, currentId: 'work', keptIds: [] }).serverRuns).toBe(true)
  })
})
