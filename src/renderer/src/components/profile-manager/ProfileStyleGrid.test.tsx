// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ICON_STYLES, type IconStyle } from '../../../../shared/icon-badger/badger'
import { ProfileStyleGrid } from './ProfileStyleGrid'

const h = vi.hoisted(() => ({
  iconParts: vi.fn(),
  render: vi.fn(),
  stop: vi.fn()
}))
vi.mock('./profile-icon-thumbnail-client', () => ({
  decodeParts: async (result: unknown) => result,
  renderThumbnail: h.render,
  stopThumbnails: h.stop
}))

beforeEach(() => {
  h.iconParts.mockReset().mockImplementation(async (icon: { text?: string }) => ({
    ok: true,
    result: { base: 'base', badge: `badge-${icon.text}` }
  }))
  h.render.mockReset().mockImplementation(async (_parts: unknown, style: string) => `url-${style}`)
  h.stop.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { appProfiles: { iconParts: h.iconParts } }
  })
})
afterEach(cleanup)

/** The grid with its own style state, as the picker holds it. */
function Grid(props: { text: string; style?: IconStyle }): React.JSX.Element {
  const [style, setStyle] = useState<IconStyle>(props.style ?? 'ref-match')
  return (
    <ProfileStyleGrid
      value={{ kind: 'badge', text: props.text, style }}
      style={style}
      onChange={setStyle}
    />
  )
}

const rendered = (): string[] => h.render.mock.calls.map(([, style]) => style as string)
const tile = (label: string): HTMLElement => screen.getByRole('radio', { name: label })

describe('ProfileStyleGrid', () => {
  it('shows a 48 px tile per style, its name under it and its id as tooltip', async () => {
    render(<Grid text="A" />)
    expect(screen.getAllByRole('radio')).toHaveLength(ICON_STYLES.length)
    expect(tile('White tile').getAttribute('title')).toBe('white-tile')
    await waitFor(() =>
      expect(tile('Stamp').querySelector('img')?.getAttribute('src')).toBe('url-stamp')
    )
    expect(tile('Stamp').querySelector('img')?.className).toContain('size-12')
  })

  it('renders the selected style first, then the grid order, from one parts read', async () => {
    render(<Grid text="B" style="stamp" />)
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(ICON_STYLES.length))
    expect(rendered()).toEqual(['stamp', ...ICON_STYLES.filter((style) => style !== 'stamp')])
    expect(h.iconParts).toHaveBeenCalledTimes(1)
    expect(h.render.mock.calls[0][0]).toEqual({ base: 'base', badge: 'badge-B' })
    // A new style is no new badge input: no new read and no new render.
    fireEvent.click(tile('Round'))
    expect(h.iconParts).toHaveBeenCalledTimes(1)
    expect(h.render).toHaveBeenCalledTimes(ICON_STYLES.length)
  })

  it('drops the work of an old badge input at once, and stops when the dialog closes', async () => {
    let finish: (url: string) => void = () => {}
    h.render.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const { rerender, unmount } = render(<Grid text="C" />)
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(1))
    rerender(<Grid text="D" />)
    expect(h.stop).toHaveBeenCalledTimes(1)
    await act(async () => finish('late'))
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(1 + ICON_STYLES.length))
    // Only the first render was for C; every later one is for D.
    expect(h.render.mock.calls.slice(1).every(([parts]) => parts.badge === 'badge-D')).toBe(true)
    unmount()
    expect(h.stop).toHaveBeenCalledTimes(2)
  })

  it('shows the done thumbnails of a badge input again at once, with no new work', async () => {
    const first = render(<Grid text="E" />)
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(ICON_STYLES.length))
    first.unmount()
    h.render.mockClear()
    h.iconParts.mockClear()
    render(<Grid text="E" />)
    expect(tile('Stamp').querySelector('img')?.getAttribute('src')).toBe('url-stamp')
    await act(async () => {})
    expect(h.render).not.toHaveBeenCalled()
    expect(h.iconParts).not.toHaveBeenCalled()
  })

  it('reads an image badge again on the next open: set-icon can write a new file at the same path', async () => {
    const image = { kind: 'image' as const, path: '/data/work/profile-icon-badge.png' }
    const first = render(
      <ProfileStyleGrid value={{ ...image, style: 'stamp' }} style="stamp" onChange={() => {}} />
    )
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(ICON_STYLES.length))
    first.unmount()
    h.render.mockClear()
    h.iconParts.mockClear()
    render(
      <ProfileStyleGrid value={{ ...image, style: 'stamp' }} style="stamp" onChange={() => {}} />
    )
    expect(tile('Stamp').querySelector('img')).toBeNull()
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(ICON_STYLES.length))
    expect(h.iconParts).toHaveBeenCalledTimes(1)
  })
})
