// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProfileIconSource } from '../../../../shared/app-profiles/app-profile-rules'
import {
  editIcon,
  ICON_PICKER_SIZE,
  iconBaseOf,
  iconChoiceReady,
  ProfileIconPicker,
  ProfileIconPreview,
  withIconBase
} from './ProfileIconPicker'

const chooseFile = vi.fn()
const preview = vi.fn()
let last: AppProfileIconSource | null = null

beforeEach(() => {
  chooseFile.mockReset().mockResolvedValue('/Users/me/base.png')
  preview.mockReset().mockResolvedValue({ ok: true, result: { png: 'UE5H' } })
  last = null
})
afterEach(cleanup)

function Chooser(props: { first: AppProfileIconSource }): React.JSX.Element {
  const [value, setValue] = useState(props.first)
  last = value
  return (
    <>
      <ProfileIconPicker
        value={value}
        onChange={setValue}
        defaultText="W"
        chooseFile={chooseFile}
      />
      <ProfileIconPreview value={value} preview={preview} />
    </>
  )
}

const checked = (name: string): string | null =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked')

describe('the icon choice helpers', () => {
  it('moves a choice to another base; no badge on an upload is the whole icon', () => {
    const badge = { kind: 'badge', text: 'W', style: 'ref-match' } as const
    expect(withIconBase(badge, 'blue')).toEqual({ ...badge, base: 'blue' })
    expect(withIconBase({ ...badge, base: 'blue' }, 'classic')).toEqual(badge)
    expect(withIconBase({ kind: 'none', base: 'blue' }, '/x.png')).toEqual({
      kind: 'file',
      path: '/x.png'
    })
    expect(withIconBase({ kind: 'file', path: '/x.png' }, 'watercolor')).toEqual({
      kind: 'none',
      base: 'watercolor'
    })
    expect(iconBaseOf({ kind: 'file', path: '/x.png' })).toBe('/x.png')
    expect(iconBaseOf(badge)).toBe('classic')
    expect(iconChoiceReady({ kind: 'none', base: 'classic' })).toBe(true)
    expect(iconChoiceReady({ kind: 'image', path: '' })).toBe(false)
  })

  it('starts from a saved icon: a built-in base id, or the kept upload', () => {
    expect(editIcon({ kind: 'none', base: 'blue' }, 'W', '/d')).toEqual({
      kind: 'none',
      base: 'blue'
    })
    expect(editIcon({ kind: 'image', style: 'stamp', base: 'custom' }, 'W', '/d')).toEqual({
      kind: 'image',
      path: '/d/profile-icon-badge.png',
      style: 'stamp',
      base: '/d/profile-icon-base.png'
    })
    expect(editIcon({ kind: 'badge', text: 'Q', style: 'stamp', base: 'watercolor' }, 'W')).toEqual(
      {
        kind: 'badge',
        text: 'Q',
        style: 'stamp',
        base: 'watercolor'
      }
    )
  })
})

describe('ProfileIconPicker', () => {
  it('changes the base and the badge apart: a built-in base, no badge, an upload', async () => {
    render(<Chooser first={{ kind: 'badge', text: 'W', style: 'ref-match' }} />)
    expect(checked('Classic')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith({
        kind: 'badge',
        text: 'W',
        style: 'ref-match',
        base: 'blue'
      })
    )
    // No badge keeps the base, and hides the badge parts.
    fireEvent.click(screen.getByRole('radio', { name: 'No badge' }))
    expect(screen.queryByLabelText('Badge character')).toBeNull()
    expect(document.querySelector('[aria-labelledby="profile-icon-style"]')).toBeNull()
    expect(last).toEqual({ kind: 'none', base: 'blue' })
    // An upload with no badge is the whole icon; a badge then goes on the upload.
    fireEvent.click(screen.getByRole('radio', { name: 'Upload…' }))
    await screen.findByText('base.png')
    expect(chooseFile).toHaveBeenLastCalledWith('file')
    expect(last).toEqual({ kind: 'file', path: '/Users/me/base.png' })
    expect(checked('Upload…')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Badge character' }))
    expect(last).toEqual({
      kind: 'badge',
      text: 'W',
      style: 'ref-match',
      base: '/Users/me/base.png'
    })
    // A badge image keeps the base too.
    chooseFile.mockResolvedValue('/Users/me/logo.svg')
    fireEvent.click(screen.getByRole('radio', { name: 'Badge image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose a badge image…' }))
    await screen.findByText('logo.svg')
    expect(last).toEqual({
      kind: 'image',
      path: '/Users/me/logo.svg',
      style: 'ref-match',
      base: '/Users/me/base.png'
    })
  })

  it('asks for a file again on a click of the selected Upload, and keeps the choice on cancel', async () => {
    render(<Chooser first={{ kind: 'file', path: '/Users/me/old.png' }} />)
    chooseFile.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('radio', { name: 'Upload…' }))
    await waitFor(() => expect(chooseFile).toHaveBeenCalledTimes(1))
    expect(last).toEqual({ kind: 'file', path: '/Users/me/old.png' })
    expect(checked('Upload…')).toBe('true')
  })

  it("shows why upstream's import refused an upload, and keeps the choice", async () => {
    render(<Chooser first={{ kind: 'none', base: 'blue' }} />)
    chooseFile.mockResolvedValue({ code: 'notSquare' })
    fireEvent.click(screen.getByRole('radio', { name: 'Upload…' }))
    expect((await screen.findByRole('alert')).textContent).toBe('App icons must be square.')
    expect(last).toEqual({ kind: 'none', base: 'blue' })
    fireEvent.click(screen.getByRole('radio', { name: 'Classic' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps one size for every base, badge kind and style', () => {
    render(<Chooser first={{ kind: 'none', base: 'blue' }} />)
    const picker = screen.getByRole('radio', { name: 'Classic' }).closest('.overflow-y-auto')!
    const preview = screen.getByRole('complementary', { name: 'Preview' })
    const sizes = (): string[] => [picker.className, preview.className]
    const first = sizes()
    expect(first[0]).toContain(ICON_PICKER_SIZE)
    expect(first[1]).toMatch(/\bw-\[\d+px\] shrink-0\b/)
    for (const name of ['Badge character', 'Badge image', 'Watercolor', 'No badge']) {
      fireEvent.click(screen.getByRole('radio', { name }))
      expect(sizes()).toEqual(first)
    }
  })
})
