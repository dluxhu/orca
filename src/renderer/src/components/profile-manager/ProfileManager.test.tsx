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
  state,
  startAtLogin: id === 'work'
})

let appState: AppProfilesState
const change = vi.fn()
const open = vi.fn()
const iconPreview = vi.fn()
const chooseIconFile = vi.fn()

beforeEach(() => {
  appState = {
    rows: [row('default', 'Orca', 'running', 6768), row('work', 'Orca - Work', 'background', 6800)],
    currentId: 'default',
    keptIds: ['client']
  }
  change.mockReset().mockResolvedValue({ ok: true, result: {} })
  open.mockReset().mockResolvedValue({ ok: true, result: {} })
  iconPreview.mockReset().mockResolvedValue({ ok: true, result: { png: 'UE5H' } })
  chooseIconFile.mockReset().mockResolvedValue('/Users/me/logo.svg')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      appProfiles: { getState: async () => appState, change, open, iconPreview, chooseIconFile }
    }
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
    // The plain app is the "Default" entry.
    expect(screen.getByText(/^Default/)).toBeTruthy()
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
    type('App name', 'Orca - Customer')
    expect(field('Profile id').value).toBe('client')
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        kind: 'create',
        name: 'Orca - Customer',
        id: 'client',
        port: 6832,
        copySettings: false,
        icon: { kind: 'badge', text: '2', style: 'ref-match' }
      })
    )
  })

  it('offers the first unused badge, shows the preview from the main process and creates with it', async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: '2', style: 'ref-match' }
    }
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    expect(field('Badge character').value).toBe('3')
    const preview = (await screen.findByAltText('Preview of the icon')) as HTMLImageElement
    expect(preview.src).toBe('data:image/png;base64,UE5H')
    expect(iconPreview).toHaveBeenLastCalledWith(
      { kind: 'badge', text: '3', style: 'ref-match' },
      undefined
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Page curl, bigger' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Badge image' }))
    // No image yet: no preview and no create.
    expect(
      (screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a badge image…' }))
    expect(await screen.findByText('logo.svg')).toBeTruthy()
    expect(chooseIconFile).toHaveBeenCalledWith('image')
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'create',
          icon: { kind: 'image', path: '/Users/me/logo.svg', style: 'ref-match-bigger' }
        })
      )
    )
  })

  it('shows the CLI error of a preview', async () => {
    iconPreview.mockResolvedValue({
      ok: false,
      error: { message: 'A badge has one visible character' }
    })
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    expect((await screen.findByRole('alert')).textContent).toContain('one visible character')
  })

  it("keeps the row's own badge in an edit: a rename sends no set-icon", async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: 'W', style: 'ref-match' }
    }
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(field('Badge character').value).toBe('W')
    type('App name', 'Orca - Job')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change.mock.calls).toEqual([[{ kind: 'rename', id: 'work', name: 'Orca - Job' }]])
  })

  it("offers the profile's own badge again in an edit: it is not taken", async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: '2', style: 'ref-match' }
    }
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Badge image' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Badge character' }))
    expect(field('Badge character').value).toBe('2')
  })

  it.each([
    [{ kind: 'image', style: 'ref-match-bigger' }, 'Badge image', 'profile-icon-badge.png'],
    [{ kind: 'file' }, 'Own icon', 'profile-icon.icns']
  ] as const)('starts an edit from the saved %o icon', async (icon, mode, file) => {
    appState.rows[1] = { ...appState.rows[1], icon }
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('radio', { name: mode }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(file)).toBeTruthy()
    const path = `/data/work/${file}`
    await waitFor(() =>
      expect(iconPreview).toHaveBeenLastCalledWith(
        icon.kind === 'image'
          ? { kind: 'image', path, style: 'ref-match-bigger' }
          : { kind: 'file', path },
        'work'
      )
    )
    type('Server port', '6864')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change.mock.calls).toEqual([[{ kind: 'set-port', id: 'work', port: 6864 }]])
  })

  it('sends no set-icon when an edit keeps the icon', async () => {
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    type('Server port', '6864')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change.mock.calls).toEqual([[{ kind: 'set-port', id: 'work', port: 6864 }]])
  })

  it('sends a new icon of an edit as set-icon, with the own badge free for the preview', async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: '2', style: 'ref-match' }
    }
    render(<ProfileManager />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(field('Badge character').value).toBe('2')
    await waitFor(() =>
      expect(iconPreview).toHaveBeenLastCalledWith(
        { kind: 'badge', text: '2', style: 'ref-match' },
        'work'
      )
    )
    type('Badge character', 'W')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        kind: 'set-icon',
        id: 'work',
        icon: { kind: 'badge', text: 'W', style: 'ref-match' }
      })
    )
    expect(change).toHaveBeenCalledTimes(1)
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

  it('shows Start at login per app and changes it for that app', async () => {
    render(<ProfileManager />)
    const boxes = await screen.findAllByRole('checkbox', { name: 'Start at login' })
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    fireEvent.click(boxes[0])
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({ kind: 'start-at-login', id: 'default', enabled: true })
    )
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
    expect(screen.queryByText('· this app')).toBeNull()
  })
})
