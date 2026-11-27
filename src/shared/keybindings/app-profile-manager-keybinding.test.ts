import { describe, expect, it } from 'vitest'
import { getWindowShortcutActionId, resolveWindowShortcutAction } from './window-shortcut-policy'

const shiftCmdP = { type: 'keyDown', key: 'P', code: 'KeyP', meta: true, shift: true }

describe('app.profileManager', () => {
  it('opens the Profile Manager on Shift+Cmd+P in main, on macOS only', () => {
    const action = resolveWindowShortcutAction(shiftCmdP, 'darwin')
    expect(action).toEqual({ type: 'openProfileManager' })
    expect(action && getWindowShortcutActionId(action)).toBe('app.profileManager')
    expect(resolveWindowShortcutAction({ ...shiftCmdP, meta: false, control: true }, 'linux')).toBe(
      null
    )
  })

  it('follows the user binding, so the user can move or remove it', () => {
    const moved = { 'app.profileManager': ['Mod+Alt+M'] }
    expect(resolveWindowShortcutAction(shiftCmdP, 'darwin', moved)).toBeNull()
    expect(
      resolveWindowShortcutAction(
        { type: 'keyDown', key: 'm', code: 'KeyM', meta: true, alt: true },
        'darwin',
        moved
      )
    ).toEqual({ type: 'openProfileManager' })
    expect(
      resolveWindowShortcutAction(shiftCmdP, 'darwin', { 'app.profileManager': [] })
    ).toBeNull()
  })
})
