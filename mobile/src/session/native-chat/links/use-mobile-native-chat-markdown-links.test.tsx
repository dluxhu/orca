import type { Root, RootContent } from 'mdast'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ repos: [] as unknown[] }))
vi.mock('../../../source-control/review/github-operations/github-pr-rpc', () => ({
  fetchGithubRepoSlug: () => Promise.resolve({ ok: true, result: { owner: 'o', repo: 'r' } })
}))
vi.mock('../../agent-launch/mobile-runtime-repo-operations', () => ({
  nativeChatRepoListRead: {
    request: () => Promise.resolve(null),
    interpret: () => ({ accepted: true, value: mocks.repos })
  }
}))

import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { useMobileMarkdownTree } from '../../../components/markdown/parsing/use-mobile-markdown-tree'
import { useMobileNativeChatMarkdownLinks } from './use-mobile-native-chat-markdown-links'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked operations never touch the client.
const client = {} as RpcClient

let latest: Root | null = null

function Probe() {
  const links = useMobileNativeChatMarkdownLinks({
    enabled: true,
    client,
    connState: 'connected',
    worktreeId: 'repo-1::/work',
    worktreePath: null,
    isWorking: false
  })
  latest = useMobileMarkdownTree('See #12, PR #12 and dluxhu/orca#12.', false, false, false, {
    fileLinkExists: undefined,
    githubRepo: links.githubRepo,
    linkBareGitHubReferences: links.linkBareGitHubReferences
  }).root
  return null
}

function links(node: Root | RootContent): string[] {
  if (node.type === 'link') {
    return [node.url]
  }
  return 'children' in node ? node.children.flatMap(links) : []
}

let tree: ReactTestRenderer | null = null

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  latest = null
})

async function renderChat(repo: Record<string, unknown>): Promise<string[]> {
  mocks.repos = [{ id: 'repo-1', ...repo }]
  await act(async () => {
    tree = create(createElement(Probe))
  })
  return latest ? links(latest) : []
}

describe("the phone's chat links for GitHub references", () => {
  it('links bare #N to the repo when the project has no value', async () => {
    expect(await renderChat({})).toEqual([
      'https://github.com/o/r/issues/12',
      'https://github.com/o/r/issues/12',
      'https://github.com/dluxhu/orca/issues/12'
    ])
  })

  it('links only owner/repo#N when the project turns bare links off', async () => {
    expect(await renderChat({ linkBareReferencesInChat: false })).toEqual([
      'https://github.com/dluxhu/orca/issues/12'
    ])
  })
})
