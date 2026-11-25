import { describe, expect, it, vi } from 'vitest'

const { show } = vi.hoisted(() => ({ show: vi.fn(async () => {}) }))
vi.mock('../../app-profiles/profile-manager-window', () => ({ showProfileManager: show }))
vi.mock('../renderer-relays/native-unload-coordinator', () => ({
  reloadWithRendererCheckpoint: vi.fn()
}))

import { sendResolvedWindowShortcutAction } from './main-window-shortcut-actions'

describe('sendResolvedWindowShortcutAction', () => {
  it('opens the Profile Manager app for app.profileManager, with no message to the window', () => {
    const send = vi.fn()
    const window = { webContents: { send } } as unknown as Parameters<
      typeof sendResolvedWindowShortcutAction
    >[0]
    sendResolvedWindowShortcutAction(window, { type: 'openProfileManager' })
    expect(show).toHaveBeenCalledWith()
    expect(send).not.toHaveBeenCalled()
  })
})
