import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProfileRow, AppProfilesState } from '../../shared/app-profiles/app-profile-rules'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  runCli: vi.fn(),
  applyAppIcon: vi.fn(),
  forget: vi.fn(),
  refreshMenuBar: vi.fn(),
  preview: vi.fn(),
  custom: false
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      h.handlers.set(channel, handler)
  }
}))
vi.mock('../ipc/ui', () => ({ isTrustedUIRenderer: () => true }))
vi.mock('./profile-manager-window', () => ({ isProfileManagerRenderer: () => false }))
vi.mock('./profile-manager-cli', () => ({ runCli: h.runCli }))
vi.mock('./profile-manager-icon', () => ({
  previewAppProfileIcon: h.preview,
  chooseAppProfileIconFile: vi.fn()
}))
vi.mock('./app-profile-dock-icon', () => ({ forgetOwnDockIcon: h.forget }))
vi.mock('../tray/system-tray', () => ({ refreshMacMenuBarImage: h.refreshMenuBar }))
vi.mock('../window/desktop-integration/app-icon', () => ({ applyAppIcon: h.applyAppIcon }))
vi.mock('../window/desktop-integration/custom-app-icon', () => ({
  hasCustomAppIcon: () => h.custom,
  getCustomAppIconPath: () => '/data/default/app-icon/custom.png'
}))

import { ownAppProfile, registerOwnProfileIpc } from './profile-manager-settings'

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
      serverRuns: false,
      userDataPath: '/data/work'
    })
    rows[1] = row('work', 'background', 6768)
    expect(ownAppProfile({ rows, currentId: 'work', keptIds: [] }).serverRuns).toBe(true)
  })

  it('carries the saved icon of the profile, and of the default app', () => {
    const icon = { kind: 'badge', text: 'D', style: 'ref-match' } as const
    const rows = [{ ...row('default', 'running', 6768), icon }]
    expect(ownAppProfile({ rows, currentId: null, keptIds: [] }).icon).toEqual(icon)
  })
})

describe('the own icon calls of Settings', () => {
  let state: AppProfilesState
  beforeEach(() => {
    h.handlers.clear()
    vi.clearAllMocks()
    h.custom = false
    state = {
      rows: [row('default', 'stopped', 6768), row('work', 'running', 6800)],
      currentId: 'work',
      keptIds: []
    }
    registerOwnProfileIpc(async () => state, vi.fn())
  })
  const call = (channel: string, ...args: unknown[]) =>
    h.handlers.get(channel)!({ sender: {} }, ...args)

  it('sets the icon of this app while it runs, then shows it in the Dock and the menu bar', async () => {
    h.runCli.mockResolvedValue({ ok: true, result: {} })
    const icon = { kind: 'badge', text: 'Q', base: 'blue' }
    await expect(call('appProfiles:setOwnIcon', icon, 'classic')).resolves.toEqual({
      ok: true,
      result: {}
    })
    expect(h.runCli).toHaveBeenCalledWith([
      'profiles',
      'set-icon',
      'work',
      '--icon-badge',
      'Q',
      '--icon-base',
      'blue',
      '--while-running',
      '--json'
    ])
    expect(h.forget).toHaveBeenCalledBefore(h.applyAppIcon)
    expect(h.applyAppIcon).toHaveBeenCalledWith('classic')
    expect(h.refreshMenuBar).toHaveBeenCalled()
  })

  it('sends the default app as `default`, and changes nothing shown after a CLI error', async () => {
    state.currentId = null
    h.runCli.mockResolvedValue({ ok: false, error: { message: 'no' } })
    await call('appProfiles:setOwnIcon', { kind: 'none', base: 'blue' }, 'blue')
    expect(h.runCli.mock.calls[0][0].slice(0, 3)).toEqual(['profiles', 'set-icon', 'default'])
    expect(h.runCli.mock.calls[0][0]).toContain('--no-badge')
    expect(h.applyAppIcon).not.toHaveBeenCalled()
    expect(h.refreshMenuBar).not.toHaveBeenCalled()
  })

  it('previews for the own id, and names an imported Settings icon', async () => {
    h.preview.mockResolvedValue({ ok: true, result: { png: '' } })
    await call('appProfiles:ownIconPreview', { kind: 'none', base: 'classic' })
    expect(h.preview).toHaveBeenCalledWith({ kind: 'none', base: 'classic' }, 'work')
    expect(await call('appProfiles:ownProfile')).not.toHaveProperty('customIconPath')
    h.custom = true
    expect(await call('appProfiles:ownProfile')).toMatchObject({
      customIconPath: '/data/default/app-icon/custom.png'
    })
  })
})
