import { beforeEach, expect, it, vi } from 'vitest'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { openDetectedFilePath } from './files/terminal-file-open-routing'
import { createTerminalLinkTestDoubles } from './terminal-link-handlers-test-fixtures'
import {
  flushAsyncWork,
  installTerminalLinkTestEnvironment,
  setPlatform
} from './terminal-link-handlers-test-harness'

const history = vi.hoisted(() => ({ isNavigatingHistory: false }))
const doubles = createTerminalLinkTestDoubles()
const { storeState, deps } = doubles

vi.mock('@/store/index', () => ({
  useAppStore: {
    getState: () => Object.assign(storeState, history),
    setState: (patch: Partial<typeof history>) => Object.assign(history, patch)
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('../../../../../shared/editor-language/editor-language-detect', () => ({
  detectLanguage: () => 'plaintext'
}))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn()
}))
vi.mock('@/lib/workspace/ownership/connection-context', () => ({
  getConnectionId: vi.fn(() => null)
}))

installTerminalLinkTestEnvironment(doubles)

// The activation records a history visit unless a history navigation is in progress.
const navigatingAtActivation = vi.fn()
vi.mocked(activateAndRevealWorkspace).mockImplementation(() => {
  navigatingAtActivation(history.isNavigatingHistory)
  return false
})

beforeEach(() => {
  navigatingAtActivation.mockClear()
  history.isNavigatingHistory = false
})

it('activates the workspace with no history visit when the caller records the history', async () => {
  setPlatform('Macintosh')
  openDetectedFilePath('/tmp/src/a.ts', null, null, { ...deps, recordsHistory: false })
  await flushAsyncWork()
  expect(navigatingAtActivation).toHaveBeenCalledExactlyOnceWith(true)
  expect(history.isNavigatingHistory).toBe(false)
})

it('records the history visit of a plain file open', async () => {
  setPlatform('Macintosh')
  openDetectedFilePath('/tmp/src/a.ts', null, null, deps)
  await flushAsyncWork()
  expect(navigatingAtActivation).toHaveBeenCalledExactlyOnceWith(false)
})
