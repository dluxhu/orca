// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { OwnAppProfile } from '../../../../../shared/app-profiles/app-profile-rules'

const h = vi.hoisted(() => ({ platform: 'darwin' as NodeJS.Platform }))
vi.mock('@/app-shell/platform/renderer-app-platform', () => ({
  getRendererAppPlatform: () => h.platform
}))
vi.mock('@/app-shell/platform/web-client-location', () => ({ isWebClientLocation: () => false }))

import { AppIconSetting, appIconSettingOf, savedAppIcon } from './AppearanceIconChooser'

const base: OwnAppProfile = {
  id: 'default',
  enabled: false,
  port: 6768,
  otherPorts: [],
  defaultPort: 6768,
  serverRuns: false,
  userDataPath: '/data/default'
}
let own: OwnAppProfile
const getOwnProfile = vi.fn(async () => own)
const setOwnIcon = vi.fn()
const ownIconPreview = vi.fn()
const chooseOwnIconFile = vi.fn()

beforeEach(() => {
  h.platform = 'darwin'
  own = base
  getOwnProfile.mockClear()
  setOwnIcon.mockReset().mockResolvedValue({ ok: true, result: {} })
  ownIconPreview.mockReset().mockResolvedValue({ ok: true, result: { png: 'UE5H' } })
  chooseOwnIconFile.mockReset().mockResolvedValue('/Users/me/base.png')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      appProfiles: { getOwnProfile, setOwnIcon, ownIconPreview, chooseOwnIconFile },
      appIcon: { readCustomPreview: vi.fn(async () => null) }
    }
  })
})

afterEach(cleanup)

const show = (value: 'classic' | 'watercolor' | 'blue' | 'custom', onChange = vi.fn()) => {
  render(
    <TooltipProvider>
      <AppIconSetting value={value} onChange={onChange} />
    </TooltipProvider>
  )
  return onChange
}
const checked = (name: string): string | null =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked')

describe('savedAppIcon and appIconSettingOf', () => {
  it('reads the kept icon first, else the appIcon setting with no badge', () => {
    expect(savedAppIcon(base, 'blue')).toEqual({ kind: 'none', base: 'blue' })
    expect(savedAppIcon({ ...base, customIconPath: '/c.png' }, 'custom')).toEqual({
      kind: 'file',
      path: '/c.png'
    })
    // The imported file is gone: main shows Classic, so the choice does too.
    expect(savedAppIcon(base, 'custom')).toEqual({ kind: 'none', base: 'classic' })
    const icon = { kind: 'badge', text: 'D', style: 'ref-match', base: 'custom' } as const
    expect(savedAppIcon({ ...base, icon }, 'classic')).toEqual({
      kind: 'badge',
      text: 'D',
      style: 'ref-match',
      base: '/data/default/profile-icon-base.png'
    })
  })

  it('keeps upstream`s setting alone only for the default app with no badge on a built-in base', () => {
    expect(appIconSettingOf(base, { kind: 'none', base: 'blue' })).toBe('blue')
    expect(appIconSettingOf(base, { kind: 'badge', text: 'D', base: 'blue' })).toBe('classic')
    expect(appIconSettingOf(base, { kind: 'file', path: '/x.png' })).toBe('classic')
    expect(appIconSettingOf({ ...base, id: 'work' }, { kind: 'none', base: 'blue' })).toBe(
      'classic'
    )
  })
})

describe('AppIconSetting', () => {
  it("is upstream's selector on other platforms, and when the profile calls fail", async () => {
    h.platform = 'win32'
    show('classic')
    expect(screen.getByRole('button', { name: 'Next icon' })).toBeTruthy()
    expect(getOwnProfile).not.toHaveBeenCalled()
    cleanup()
    h.platform = 'darwin'
    getOwnProfile.mockRejectedValueOnce(new Error('no profiles'))
    show('classic')
    await waitFor(() => expect(getOwnProfile).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Next icon' })).toBeTruthy()
  })

  it('adds a badge to the default app: the kept icon, with Classic as the setting', async () => {
    const onChange = show('watercolor')
    await screen.findByRole('radio', { name: 'Watercolor' })
    expect(checked('Watercolor')).toBe('true')
    expect(checked('No badge')).toBe('true')
    const apply = screen.getByRole('button', { name: 'Apply icon' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Badge character' }))
    await waitFor(() =>
      expect(ownIconPreview).toHaveBeenLastCalledWith({
        kind: 'badge',
        text: '2',
        style: 'ref-match',
        base: 'watercolor'
      })
    )
    fireEvent.click(apply)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('classic'))
    expect(setOwnIcon).toHaveBeenCalledWith(
      { kind: 'badge', text: '2', style: 'ref-match', base: 'watercolor' },
      'classic'
    )
    // The saved icon is read again.
    await waitFor(() => expect(getOwnProfile).toHaveBeenCalledTimes(2))
  })

  it('takes the badge off the default app: the built-in setting again, as upstream has it', async () => {
    own = { ...base, icon: { kind: 'badge', text: 'D', style: 'ref-match' } }
    const onChange = show('classic')
    await screen.findByRole('radio', { name: 'Blue' })
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    fireEvent.click(screen.getByRole('radio', { name: 'No badge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply icon' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('blue'))
    expect(setOwnIcon).toHaveBeenCalledWith({ kind: 'none', base: 'blue' }, 'blue')
  })

  it('changes the icon of a profile app with an upload; a CLI error shows and saves nothing', async () => {
    own = { ...base, id: 'work', icon: { kind: 'badge', text: 'W', style: 'ref-match' } }
    setOwnIcon.mockResolvedValueOnce({ ok: false, error: { message: 'AppKit failed' } })
    const onChange = show('classic')
    await screen.findByRole('radio', { name: 'Upload…' })
    expect(screen.getByLabelText('Badge character')).toHaveProperty('value', 'W')
    fireEvent.click(screen.getByRole('radio', { name: 'Upload…' }))
    await screen.findByText('base.png')
    expect(chooseOwnIconFile).toHaveBeenCalledWith('file')
    fireEvent.click(screen.getByRole('button', { name: 'Apply icon' }))
    expect((await screen.findByRole('alert')).textContent).toBe('AppKit failed')
    expect(setOwnIcon).toHaveBeenCalledWith(
      { kind: 'badge', text: 'W', style: 'ref-match', base: '/Users/me/base.png' },
      'classic'
    )
    expect(onChange).not.toHaveBeenCalled()
    // Reset goes back to the saved icon.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByText('base.png')).toBeNull()
  })
})
