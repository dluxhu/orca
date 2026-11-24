// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StartAtLoginSetting } from './StartAtLoginSetting'

let enabled: boolean
let own: {
  id: string
  port: number
  otherPorts: number[]
  defaultPort: number
  serverRuns: boolean
}
const setOwnStartAtLogin = vi.fn()
const setOwnPort = vi.fn()
const getOwnProfile = vi.fn(async () => ({ ...own, enabled }))

beforeEach(() => {
  enabled = true
  own = { id: 'work', port: 6800, otherPorts: [6832], defaultPort: 6768, serverRuns: false }
  setOwnPort.mockReset().mockImplementation(async (port: number) => {
    own = { ...own, port }
    return { ok: true, result: {} }
  })
  setOwnStartAtLogin.mockReset().mockResolvedValue({
    ok: false,
    error: { message: 'launchctl bootstrap failed' }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      appProfiles: {
        getOwnProfile,
        setOwnStartAtLogin,
        setOwnPort
      }
    }
  })
})

afterEach(cleanup)

// A disabled field has a tooltip, which needs the provider that the app has.
const show = (query: string) =>
  render(
    <TooltipProvider>
      <StartAtLoginSetting query={query} />
    </TooltipProvider>
  )

describe('StartAtLoginSetting', () => {
  it("shows this app's service state and shows a failed change", async () => {
    show('')
    const toggle = await screen.findByRole('switch', { name: 'Start at login' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(setOwnStartAtLogin).toHaveBeenCalledWith(false)
    expect((await screen.findByRole('alert')).textContent).toContain('launchctl bootstrap failed')
    // The state comes from the service again, not from the click.
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  })

  it('changes the saved port only after the re-pair warning is confirmed', async () => {
    show('')
    const port = await screen.findByRole('spinbutton', { name: 'Port' })
    expect((port as HTMLInputElement).value).toBe('6800')
    fireEvent.change(port, { target: { value: '6864' } })
    fireEvent.blur(port)
    const dialog = await screen.findByRole('dialog', {
      name: 'Change the port to 6864?',
      description: 'Paired servers will need to be re-paired.'
    })
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(setOwnPort).not.toHaveBeenCalled()
    // Cancel puts the field back to the saved port.
    const portField = (): HTMLInputElement => screen.getByRole('spinbutton', { name: 'Port' })
    await waitFor(() => expect(portField().value).toBe('6800'))
    fireEvent.change(portField(), { target: { value: '6864' } })
    fireEvent.blur(portField())
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change port' })
    )
    await waitFor(() => expect(setOwnPort).toHaveBeenCalledWith(6864))
    await waitFor(() => expect(portField().value).toBe('6864'))
  })

  it('refuses the port of another profile before it asks, and warns about a saved clash', async () => {
    show('')
    const port = await screen.findByRole('spinbutton', { name: 'Port' })
    fireEvent.change(port, { target: { value: '6840' } })
    fireEvent.blur(port)
    expect((await screen.findByRole('alert')).textContent).toContain('inside the port range')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setOwnPort).not.toHaveBeenCalled()
    cleanup()
    // A hand edit gave this profile the default app's port.
    own = { ...own, port: 6768 }
    show('')
    expect((await screen.findByRole('alert')).textContent).toContain('6768')
  })

  it('keeps the port read-only while the server runs', async () => {
    own = { ...own, serverRuns: true }
    show('')
    const port = await screen.findByRole('spinbutton', { name: 'Port' })
    expect((port as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText("Stop this profile's server to change its port.")).toBeTruthy()
  })

  it('the default app changes its port too, and refuses the saved port of a profile', async () => {
    own = { id: 'default', port: 6768, otherPorts: [6800], defaultPort: 6768, serverRuns: false }
    show('')
    const port = await screen.findByRole('spinbutton', { name: 'Port' })
    expect((port as HTMLInputElement).disabled).toBe(false)
    // Its own built-in port is no clash.
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(port, { target: { value: '6800' } })
    fireEvent.blur(port)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Another profile saves the port 6800.'
    )
    // Next to a profile's port is fine for the default app.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Port' }), {
      target: { value: '6769' }
    })
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Port' }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change port' })
    )
    await waitFor(() => expect(setOwnPort).toHaveBeenCalledWith(6769))
  })

  it("a profile's range check follows the default app's saved port", async () => {
    own = { ...own, port: 6768, defaultPort: 6769 }
    show('')
    await screen.findByRole('spinbutton', { name: 'Port' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides itself when the search does not match', async () => {
    getOwnProfile.mockClear()
    show('zzz-no-match')
    // Settle: the state read is done and React has rendered its result.
    await waitFor(() => expect(getOwnProfile).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
