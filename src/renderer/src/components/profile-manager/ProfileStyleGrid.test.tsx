// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ICON_STYLES, type IconStyle } from '../../../../shared/icon-badger/badger'
import { ProfileStyleGrid } from './ProfileStyleGrid'

afterEach(cleanup)

/** The grid with its own style state, as the picker holds it. */
function Grid(props: { style?: IconStyle }): React.JSX.Element {
  const [style, setStyle] = useState<IconStyle>(props.style ?? 'ref-match')
  return <ProfileStyleGrid style={style} onChange={setStyle} />
}

const tile = (label: string): HTMLElement => screen.getByRole('radio', { name: label })

describe('ProfileStyleGrid', () => {
  it('shows the bundled 48 px thumbnail of each style at once, with no IPC', () => {
    // No window.api: the thumbnails come from the bundle, not from the main process.
    render(<Grid />)
    expect(screen.getAllByRole('radio')).toHaveLength(ICON_STYLES.length)
    for (const style of ICON_STYLES) {
      const img = screen.getByTitle(style).querySelector('img')
      expect(img?.getAttribute('src')).toMatch(new RegExp(`/profile-icon-styles/${style}\\.png$`))
      expect(img?.className).toContain('size-12')
      // A style without a translated name shows its id: every style has a name.
      expect(screen.getByTitle(style).textContent).not.toBe(style)
    }
  })

  it('shows the style name under the tile, its id as tooltip, and selects a style', () => {
    render(<Grid style="stamp" />)
    expect(tile('White tile').getAttribute('title')).toBe('white-tile')
    expect(tile('Stamp').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(tile('Round'))
    expect(tile('Round').getAttribute('aria-checked')).toBe('true')
    expect(tile('Stamp').getAttribute('aria-checked')).toBe('false')
  })
})
