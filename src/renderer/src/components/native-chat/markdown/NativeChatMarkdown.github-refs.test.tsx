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

const links = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])

describe('GitHub references', () => {
  it('in a native chat, links only owner/repo#N', () => {
    const { container } = render(
      <NativeChatLinkPeekContext
        value={{
          githubRepo: { repo: TEST_REPO, identityKeys: [], referenceRepo: REPO },
          githubRoutingAuthorityKey: null,
          webPreviews: null
        }}
      >
        <NativeChatMarkdown content={CONTENT} variant="document" />
      </NativeChatLinkPeekContext>
    )
    expect(links(container)).toEqual([
      ['dluxhu/orca#12', 'https://github.com/dluxhu/orca/issues/12']
    ])
    expect(container.textContent).toContain('See #12, PR #12 and dluxhu/orca#12.')
  })

  it('on other surfaces, links bare #N to the repo', () => {
    const { container } = render(<CommentMarkdown content={CONTENT} githubRepo={REPO} />)
    expect(links(container)).toEqual([
      ['#12', 'https://github.com/o/r/issues/12'],
      ['#12', 'https://github.com/o/r/issues/12'],
      ['dluxhu/orca#12', 'https://github.com/dluxhu/orca/issues/12']
    ])
  })
})
