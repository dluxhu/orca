// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartAtLoginSetting } from './StartAtLoginSetting'

let enabled: boolean
const setOwnStartAtLogin = vi.fn()
const getOwnStartAtLogin = vi.fn(async () => ({ id: 'default', enabled }))

beforeEach(() => {
  enabled = true
  setOwnStartAtLogin.mockReset().mockResolvedValue({
    ok: false,
    error: { message: 'launchctl bootstrap failed' }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      appProfiles: {
        getOwnStartAtLogin,
        setOwnStartAtLogin
      }
    }
  })
})

afterEach(cleanup)

describe('StartAtLoginSetting', () => {
  it("shows this app's service state and shows a failed change", async () => {
    render(<StartAtLoginSetting query="" />)
    const toggle = await screen.findByRole('switch', { name: 'Start at login' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(setOwnStartAtLogin).toHaveBeenCalledWith(false)
    expect((await screen.findByRole('alert')).textContent).toContain('launchctl bootstrap failed')
    // The state comes from the service again, not from the click.
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  })

  it('hides itself when the search does not match', async () => {
    getOwnStartAtLogin.mockClear()
    render(<StartAtLoginSetting query="zzz-no-match" />)
    // Settle: the state read is done and React has rendered its result.
    await waitFor(() => expect(getOwnStartAtLogin).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
