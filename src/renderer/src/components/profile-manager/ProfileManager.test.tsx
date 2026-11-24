// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppProfileRow,
  AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'
import { PROFILE_STATE_POLL_MS, ProfileManager } from './ProfileManager'

const row = (id: string, name: string, state: AppProfileRow['state'], port: number) => ({
  id,
  name,
  appPath: id === 'default' ? '/Applications/Orca.app' : `/apps/${name}.app`,
  userDataPath: `/data/${id}`,
  port,
  state,
  startAtLogin: id === 'work'
})

let appState: AppProfilesState
const getState = vi.fn()
const change = vi.fn()
const open = vi.fn()
const showInFinder = vi.fn()
let startNew: (() => void) | null = null
const onStartNew = (callback: () => void) => {
  startNew = callback
  return () => {
    startNew = null
  }
}

beforeEach(() => {
  appState = {
    rows: [
      row('default', 'Default', 'running', 6768),
      row('work', 'Orca - Work', 'background', 6800),
      row('home', 'Orca - Home', 'stopped', 6832)
    ],
    currentId: 'default',
    keptIds: ['client']
  }
  getState.mockReset().mockImplementation(async () => appState)
  change.mockReset().mockResolvedValue({ ok: true, result: {} })
  open.mockReset().mockResolvedValue({ ok: true, result: {} })
  showInFinder.mockReset().mockResolvedValue({ ok: true, result: {} })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { appProfiles: { getState, change, open, showInFinder, onStartNew } }
  })
})

afterEach(() => {
  window.location.hash = ''
  cleanup()
  vi.useRealTimers()
})

const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string, value: string): void => {
  fireEvent.change(field(label), { target: { value } })
}
const rowOf = (name: string): HTMLElement => screen.getByText(name).closest('li') as HTMLElement
/** Opens the "…" menu of a row. Radix opens it on pointerdown. */
const openMore = (name: string): void => {
  fireEvent.pointerDown(screen.getByRole('button', { name: `More actions for ${name}` }), {
    button: 0,
    ctrlKey: false
  })
}

describe('ProfileManager', () => {
  it('lists every app with its state; Open opens it', async () => {
    render(<ProfileManager />)
    expect(await screen.findByText('Running in background')).toBeTruthy()
    // The plain app shows its app name and a "Default" pill.
    expect(within(rowOf('Orca')).getByText('Default · this app')).toBeTruthy()
    expect(within(rowOf('Orca')).getByText('/Applications/Orca.app')).toBeTruthy()
    fireEvent.click(within(rowOf('Orca - Work')).getByRole('button', { name: 'Open' }))
    expect(open).toHaveBeenCalledWith('work')
    // The default app has no Edit.
    expect(within(rowOf('Orca')).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Command line' })).toBeTruthy()
  })

  it('shows a running state in green with a dot, and Stopped muted with a ring', async () => {
    render(<ProfileManager />)
    const running = await screen.findByText('Running')
    const background = screen.getByText('Running in background')
    const stopped = screen.getByText('Stopped')
    for (const label of [running, background]) {
      expect(label.className).toContain('dark:text-[#86efac]')
      expect(label.className).toContain('text-green-700')
      expect(within(label).getByTestId('profile-status-dot').className).toContain('bg-[#22c55e]')
    }
    expect(stopped.className).toContain('text-muted-foreground')
    expect(within(stopped).getByTestId('profile-status-dot').className).toContain('border')
    expect(within(stopped).getByTestId('profile-status-dot').className).not.toContain('bg-')
  })

  it('reads the states again every 3 s while the window shows, and not while it hides', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    render(<ProfileManager />)
    await act(async () => {})
    expect(getState).toHaveBeenCalledTimes(1)
    appState = { ...appState, rows: [{ ...appState.rows[0] }, { ...appState.rows[2] }] }
    appState.rows[1].state = 'running'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROFILE_STATE_POLL_MS)
    })
    expect(getState).toHaveBeenCalledTimes(2)
    expect(within(rowOf('Orca - Home')).getByText('Running')).toBeTruthy()
    visibility.mockReturnValue('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROFILE_STATE_POLL_MS * 3)
    })
    expect(getState).toHaveBeenCalledTimes(2)
    visibility.mockRestore()
  })

  it('makes the id from the name until the user edits the id, then creates the profile', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    const dialog = screen.getByRole('dialog', { name: 'New profile' })
    // A modal dialog: the list behind it is out of the accessibility tree.
    expect(screen.queryByRole('heading', { name: 'Your profiles' })).toBeNull()
    expect(within(dialog).getByText(/Orca makes a new Mac app for this profile/)).toBeTruthy()
    expect(field('App name').value).toBe('Orca - New Profile')
    expect(field('Profile id').value).toBe('new-profile')
    expect(field('Server port').value).toBe('6864')
    type('App name', 'Orca - Client X')
    expect(field('Profile id').value).toBe('client-x')
    type('Profile id', 'client')
    expect(screen.getByText(/A data folder for "client" exists/)).toBeTruthy()
    type('App name', 'Orca - Customer')
    expect(field('Profile id').value).toBe('client')
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        kind: 'create',
        name: 'Orca - Customer',
        id: 'client',
        port: 6864,
        copySettings: false
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens the New dialog when the window starts with #new, after the list loads', async () => {
    window.location.hash = '#new'
    render(<ProfileManager />)
    const dialog = await screen.findByRole('dialog', { name: 'New profile' })
    // The defaults come from the loaded list: the next free port.
    expect(within(dialog).getByLabelText<HTMLInputElement>('Server port').value).toBe('6864')
  })

  it('opens the New dialog on the Profiles > New profile… event of an open window', async () => {
    render(<ProfileManager />)
    await screen.findByText('Orca - Work')
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => startNew?.())
    expect(await screen.findByRole('dialog', { name: 'New profile' })).toBeTruthy()
  })

  it('refuses a taken id before it calls the CLI', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    type('Profile id', 'Work')
    expect(screen.getByRole('alert').textContent).toContain('exists')
    expect(
      (screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('sends only the changed fields of an edit, and shows a CLI error in the dialog', async () => {
    change.mockResolvedValueOnce({ ok: false, error: { message: '"Orca - Work" runs.' } })
    render(<ProfileManager />)
    await screen.findByText('Orca - Work')
    fireEvent.click(within(rowOf('Orca - Work')).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Orca - Work' })
    type('App name', 'Orca - Job')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('"Orca - Work" runs.')).toBeTruthy()
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith({ kind: 'rename', id: 'work', name: 'Orca - Job' })
  })

  it('removes from the "…" menu, with "Keep data" on by default', async () => {
    render(<ProfileManager />)
    await screen.findByText('Orca - Work')
    openMore('Orca - Work')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove profile…' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Orca - Work?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({ kind: 'remove', id: 'work', keepData: true })
    )
  })

  it('the "…" menu shows in Finder and changes Start at login; the default has no Remove', async () => {
    render(<ProfileManager />)
    await screen.findByText('Orca - Work')
    openMore('Orca')
    const login = await screen.findByRole('menuitemcheckbox', { name: 'Start at login' })
    expect(login.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: 'Remove profile…' })).toBeNull()
    fireEvent.click(login)
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({ kind: 'start-at-login', id: 'default', enabled: true })
    )
    openMore('Orca - Work')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show in Finder' }))
    expect(showInFinder).toHaveBeenCalledWith('work')
  })

  it('offers "Copy settings" only in an app that has settings, not in the Profile Manager app', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    expect(screen.getByLabelText('Copy settings from this app')).toBeTruthy()
    cleanup()
    appState = { ...appState, currentId: null }
    render(<ProfileManager />)
    // The state is loaded before the form opens.
    expect(await screen.findByText('Running in background')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    expect(screen.queryByLabelText('Copy settings from this app')).toBeNull()
    expect(screen.queryByText('Default · this app')).toBeNull()
    expect(screen.getByText('Default')).toBeTruthy()
  })
})
