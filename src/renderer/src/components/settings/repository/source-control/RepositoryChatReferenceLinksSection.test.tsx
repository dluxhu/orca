// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { RepositoryChatReferenceLinksSection } from './RepositoryChatReferenceLinksSection'

afterEach(cleanup)

describe('RepositoryChatReferenceLinksSection', () => {
  it('is on when the repo has no value, and a click turns it off', () => {
    const updateRepo = vi.fn()
    render(<RepositoryChatReferenceLinksSection repo={TEST_REPO} updateRepo={updateRepo} />)
    const toggle = screen.getByRole('switch', { name: 'Link bare #numbers in chat' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(updateRepo).toHaveBeenCalledWith(TEST_REPO.id, { linkBareReferencesInChat: false })
  })

  it('is off when the repo turns it off, and a click turns it on', () => {
    const updateRepo = vi.fn()
    render(
      <RepositoryChatReferenceLinksSection
        repo={{ ...TEST_REPO, linkBareReferencesInChat: false }}
        updateRepo={updateRepo}
      />
    )
    const toggle = screen.getByRole('switch', { name: 'Link bare #numbers in chat' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(updateRepo).toHaveBeenCalledWith(TEST_REPO.id, { linkBareReferencesInChat: true })
  })
})
