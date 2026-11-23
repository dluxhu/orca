// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppProfileRow,
  AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'
import { ProfileManager } from './ProfileManager'

const row = (id: string, name: string, state: AppProfileRow['state'], port: number) => ({
  id,
  name,
  appPath: `/apps/${name}.app`,
  userDataPath: `/data/${id}`,
  port,
  state
})

let appState: AppProfilesState
const change = vi.fn()
const open = vi.fn()

beforeEach(() => {
  appState = {
    rows: [row('default', 'Orca', 'running', 6768), row('work', 'Orca - Work', 'background', 6800)],
    currentId: 'default',
    keptIds: ['client']
  }
  change.mockReset().mockResolvedValue({ ok: true, result: {} })
  open.mockReset().mockResolvedValue({ ok: true, result: {} })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { appProfiles: { getState: async () => appState, change, open } }
  })
})

afterEach(cleanup)

const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string, value: string): void => {
  fireEvent.change(field(label), { target: { value } })
}

describe('ProfileManager', () => {
  it('lists every app with its state; Open opens it', async () => {
    render(<ProfileManager />)
    expect(await screen.findByText('Running in background')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('· this app')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1])
    expect(open).toHaveBeenCalledWith('work')
    // The default app has no Edit or Remove.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('makes the id from the name until the user edits the id, then creates the profile', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    expect(field('App name').value).toBe('Orca - New Profile')
    expect(field('Profile id').value).toBe('new-profile')
    expect(field('Server port').value).toBe('6832')
    type('App name', 'Orca - Client X')
    expect(field('Profile id').value).toBe('client-x')
    type('Profile id', 'client')
    expect(screen.getByText(/A data folder for "client" exists/)).toBeTruthy()
    type('App name', 'Orca - Client')
    expect(field('Profile id').value).toBe('client')
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        kind: 'create',
        name: 'Orca - Client',
        id: 'client',
        port: 6832,
        copySettings: false
      })
    )
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

  it('sends only the changed fields of an edit, and shows a CLI error', async () => {
    change.mockResolvedValueOnce({ ok: false, error: { message: '"Orca - Work" runs.' } })
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    type('App name', 'Orca - Job')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('"Orca - Work" runs.')).toBeTruthy()
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith({ kind: 'rename', id: 'work', name: 'Orca - Job' })
  })

  it('removes with "Keep data" on by default', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Orca - Work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({ kind: 'remove', id: 'work', keepData: true })
    )
  })
})
