// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/store/index', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'light' } })
}))

import { NativeChatMarkdown } from '../markdown/NativeChatMarkdown'

afterEach(cleanup)

it('shows a sent quote as a chip that opens the quoted text', () => {
  render(
    <NativeChatMarkdown content={'> quoted\n> words\n\nmy reply'} variant="document" quoteChips />
  )
  const chip = screen.getByRole('button', { name: 'Quote: quoted words' })
  expect(chip).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText('my reply')).toBeInTheDocument()
  expect(document.querySelector('blockquote')).toBeNull()
  fireEvent.click(chip)
  expect(chip).toHaveAttribute('aria-expanded', 'true')
  expect(document.querySelector('blockquote')).toHaveTextContent('quoted words')
  fireEvent.click(chip)
  expect(document.querySelector('blockquote')).toBeNull()
})

it('keeps blockquotes as text where quote chips are off', () => {
  render(<NativeChatMarkdown content="> quoted" variant="document" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(document.querySelector('blockquote')).toHaveTextContent('quoted')
})
