// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CommentMarkdown from '@/components/comment-markdown/CommentMarkdown'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatLinkPeekContext } from '../links/previews/native-chat-link-peek-context'

afterEach(cleanup)

const CONTENT = 'See #12, PR #12 and dluxhu/orca#12.'
const REPO = { owner: 'o', repo: 'r' }
const BARE = ['#12', 'https://github.com/o/r/issues/12']
const QUALIFIED = ['dluxhu/orca#12', 'https://github.com/dluxhu/orca/issues/12']

const links = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])

function renderChat(linkBareReferencesInChat?: boolean) {
  return render(
    <NativeChatLinkPeekContext
      value={{
        githubRepo: {
          repo: { ...TEST_REPO, linkBareReferencesInChat },
          identityKeys: [],
          referenceRepo: REPO
        },
        githubRoutingAuthorityKey: null,
        webPreviews: null
      }}
    >
      <NativeChatMarkdown content={CONTENT} variant="document" />
    </NativeChatLinkPeekContext>
  )
}

describe('GitHub references in a native chat', () => {
  it('links bare #N to the repo when the setting is absent', () => {
    expect(links(renderChat().container)).toEqual([BARE, BARE, QUALIFIED])
  })

  it('links only owner/repo#N when the repo turns the setting off', () => {
    const { container } = renderChat(false)
    expect(links(container)).toEqual([QUALIFIED])
    expect(container.textContent).toContain('See #12, PR #12 and dluxhu/orca#12.')
  })
})

describe('GitHub references on other surfaces', () => {
  it('link bare #N to the repo', () => {
    const { container } = render(<CommentMarkdown content={CONTENT} githubRepo={REPO} />)
    expect(links(container)).toEqual([BARE, BARE, QUALIFIED])
  })
})
