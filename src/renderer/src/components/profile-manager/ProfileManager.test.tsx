// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppProfileRow,
  AppProfilesState
} from '../../../../shared/app-profiles/app-profile-rules'
import { ICON_STYLES } from '../../../../shared/icon-badger/badger'
import { PROFILE_STATE_POLL_MS, ProfileManager } from './ProfileManager'

// ProfileStyleGrid.test.tsx covers the thumbnails.
vi.mock('./profile-icon-thumbnail-client', () => ({
  decodeParts: async () => ({}),
  renderThumbnail: async () => 'data:image/png;base64,VEhVTUI=',
  stopThumbnails: () => {}
}))

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
const iconPreview = vi.fn()
const chooseIconFile = vi.fn()
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
  iconPreview.mockReset().mockResolvedValue({ ok: true, result: { png: 'UE5H' } })
  chooseIconFile.mockReset().mockResolvedValue('/Users/me/logo.svg')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      appProfiles: {
        getState,
        change,
        open,
        showInFinder,
        iconPreview,
        chooseIconFile,
        iconParts: async () => ({ ok: true, result: { base: '', badge: '' } }),
        onStartNew
      }
    }
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

const editWork = async (): Promise<void> => {
  await screen.findByText('Orca - Work')
  fireEvent.click(within(rowOf('Orca - Work')).getByRole('button', { name: 'Edit' }))
}

/** Clicks "New profile" after the list loads: the dialog defaults need it. */
const clickNew = async (): Promise<void> => {
  await screen.findByText('Orca - Work')
  fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
}

describe('ProfileManager', () => {
  it('offers New profile only after the list loads, so the defaults miss no profile', async () => {
    let loaded: (state: AppProfilesState) => void = () => {}
    getState.mockReturnValueOnce(new Promise((resolve) => (loaded = resolve)))
    render(<ProfileManager />)
    const button = screen.getByRole('button', { name: 'New profile' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => loaded(appState))
    expect(button.disabled).toBe(false)
  })

  it("shows each app's own Dock icon from the main process", async () => {
    appState = { ...appState, icons: { default: 'data:image/png;base64,T1JDQQ==' } }
    render(<ProfileManager />)
    await screen.findByText('Orca - Work')
    expect(rowOf('Orca').querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,T1JDQQ=='
    )
    // A row without an icon keeps the space, so the names line up.
    expect(rowOf('Orca - Work').querySelector('img')).toBeNull()
  })

  it('offers every badge style, and shows the preview on a light and a dark Dock', async () => {
    render(<ProfileManager />)
    await clickNew()
    const styles = within(
      document.querySelector('[aria-labelledby="profile-icon-style"]') as HTMLElement
    ).getAllByRole('radio')
    expect(styles).toHaveLength(ICON_STYLES.length)
    await screen.findByAltText('Preview of the icon')
    const aside = screen.getByRole('complementary', { name: 'Preview' })
    expect(aside.querySelectorAll('img[src="data:image/png;base64,UE5H"]')).toHaveLength(2)
  })

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
    await clickNew()
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
        copySettings: false,
        icon: { kind: 'badge', text: '2', style: 'ref-match' }
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers the first unused badge, shows the preview from the main process and creates with it', async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: '2', style: 'ref-match' }
    }
    render(<ProfileManager />)
    await clickNew()
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
    await clickNew()
    expect((await screen.findByRole('alert')).textContent).toContain('one visible character')
  })

  it("keeps the row's own badge in an edit: a rename sends no set-icon", async () => {
    appState.rows[1] = {
      ...appState.rows[1],
      icon: { kind: 'badge', text: 'W', style: 'ref-match' }
    }
    render(<ProfileManager />)
    await editWork()
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
    await editWork()
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
    await editWork()
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
    await editWork()
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
    await editWork()
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
    await clickNew()
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
    await clickNew()
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
