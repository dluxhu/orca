// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyStoreNote } from '../settings/voice/KeyStoreNote'
import { LocalPathLink } from './LocalPathLink'

const PROFILE = '/Users/me/Library/Application Support/Orca Profiles/work'
const BOT = `${PROFILE}/bots/reviewer`

function stubWindow(orcaHomeDir: string | null, opened = true) {
  const shell = {
    openFilePath: vi.fn(async () => opened),
    openInFileManager: vi.fn(async () => ({ ok: opened }))
  }
  vi.stubGlobal('api', { platform: { get: () => ({ orcaHomeDir }) }, shell })
  return shell
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LocalPathLink', () => {
  it('opens the real folder, not the label', async () => {
    const shell = stubWindow(`${PROFILE}/orca-home`)
    render(<LocalPathLink label="$PROFILE/bots/reviewer" path={BOT} hostId="local" kind="folder" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder $PROFILE/bots/reviewer' }))
    await vi.waitFor(() => expect(shell.openFilePath).toHaveBeenCalledWith(BOT, 'local'))
    expect(shell.openInFileManager).not.toHaveBeenCalled()
  })

  it('shows a file in its folder', async () => {
    const shell = stubWindow(`${PROFILE}/orca-home`)
    const file = `${PROFILE}/orca-home/keybindings.json`
    render(
      <LocalPathLink
        label="$PROFILE/orca-home/keybindings.json"
        path={file}
        hostId="local"
        kind="file"
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show $PROFILE/orca-home/keybindings.json in its folder' })
    )
    await vi.waitFor(() => expect(shell.openInFileManager).toHaveBeenCalledWith(file, 'local'))
    expect(shell.openFilePath).not.toHaveBeenCalled()
  })

  it('opens the parent folder when the path does not exist yet', async () => {
    const shell = stubWindow('/Users/me/.orca', false)
    render(
      <LocalPathLink
        label="~/.orca/bots/new"
        path="/Users/me/.orca/bots/new"
        hostId="local"
        kind="folder"
      />
    )
    fireEvent.click(screen.getByRole('button'))
    await vi.waitFor(() =>
      expect(shell.openFilePath).toHaveBeenLastCalledWith('/Users/me/.orca/bots', 'local')
    )
  })

  it('is plain text for a paired server and in the web client', () => {
    stubWindow('/Users/me/.orca')
    const { rerender } = render(
      <LocalPathLink
        label="~/.orca/bots/reviewer"
        path="/home/srv/.orca/bots/reviewer"
        hostId="runtime:env-1"
        kind="folder"
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('~/.orca/bots/reviewer')).toBeTruthy()
    stubWindow(null)
    rerender(
      <LocalPathLink
        label="~/.orca/bots/reviewer"
        path="/Users/me/.orca/bots/reviewer"
        hostId="local"
        kind="folder"
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a link inside a translated sentence', async () => {
    const shell = stubWindow('/Users/me/.orca')
    const { container } = render(<KeyStoreNote />)
    expect(container.textContent).toBe(
      'Local runtime keys are stored in ~/.orca using Electron encrypted storage when available.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open folder ~/.orca' }))
    await vi.waitFor(() =>
      expect(shell.openFilePath).toHaveBeenCalledWith('/Users/me/.orca', 'local')
    )
  })
})
