// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  toast: vi.fn(),
  activateTab: vi.fn(),
  activate: vi.fn((_id: string, _opts?: unknown): unknown => true),
  activateView: vi.fn(),
  landed: vi.fn()
}))
vi.mock('@/store/index', async () => {
  const { createWorktreeNavHistorySlice } =
    await import('@/store/slices/ui/workspace-navigation-history')
  // oxlint-disable-next-line typescript/no-explicit-any -- SAFETY: the history reads only the fields set here.
  const useAppStore = create<any>()((set, get, api) => ({
    ...createWorktreeNavHistorySlice(set, get, api),
    settings: { theme: 'light' },
    worktreesByRepo: { repo: [{ id: 'w0' }, { id: 'w1' }] },
    folderWorkspaces: [],
    unifiedTabsByWorktree: {},
    activateTab: mocks.activateTab
  }))
  return { useAppStore }
})
vi.mock('@/components/terminal-pane/links/files/terminal-file-open-routing', () => ({
  openDetectedFilePath: mocks.open
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn()
}))

import { useAppStore } from '@/store/index'
import { registerWorktreeActivation } from '@/lib/workspace/activation/worktree-activation-nav-registration'
import { reopenClosedWorkspaceTab } from '@/components/terminal/tab-lifecycle/reopen-closed-workspace-tab'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TranslationScopeProvider } from '@/i18n/translation-scope-provider'
import { MessageRow } from '../messages/rows/NativeChatMessageRow'
import { NativeChatMarkdown } from '../markdown/NativeChatMarkdown'
import { NativeChatMarkdownImageOwnerContext } from '../media/images/native-chat-markdown-image-owner'
import { NativeChatQuoteJumpContext, useNativeChatQuoteJump } from './use-native-chat-quote-jump'
import { rememberNativeChatQuoteSource } from './native-chat-quote-sources'
import { beginLinkOpenRequest } from '@/lib/links/link-open-request'
import type { NativeChatTranscriptSlot } from '../conversation/slots/native-chat-transcript-slots'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import type { AppState } from '@/store/types'

const issue = vi.fn()
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the jump reads only each slot's kind and message id.
const SLOTS = [
  { kind: 'message', message: { id: 'reply-1' } },
  { kind: 'message', message: { id: 'mine-earlier' } },
  { kind: 'message', message: { id: 'mine' } }
] as unknown as NativeChatTranscriptSlot[]
const OWNER = {
  // A terminal chat names its terminal, not its unified tab.
  fileLinkContext: {
    worktreeId: 'w1',
    worktreePath: '/repo',
    runtimeEnvironmentId: null,
    sourceTabId: 'term-1'
  },
  runtimeContext: null,
  isVisible: true
}

const NO_HISTORY_JUMP = (): void => {}

function Chat({
  content,
  owner = OWNER,
  startHistoryJump = NO_HISTORY_JUMP
}: {
  content: string
  owner?: React.ContextType<typeof NativeChatMarkdownImageOwnerContext>
  startHistoryJump?: Parameters<typeof useNativeChatQuoteJump>[0]['startHistoryJump']
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const jump = useNativeChatQuoteJump({
    slots: SLOTS,
    scrollRef,
    request: { issue, nextRequestId: () => 1 },
    beginNavigation: () => {},
    readerLeavesEnd: () => {},
    startHistoryJump,
    sessionKey: 'claude:chat',
    unfoldTurnOf: () => false
  })
  return (
    <TooltipProvider delayDuration={0}>
      <NativeChatMarkdownImageOwnerContext.Provider value={owner}>
        <NativeChatQuoteJumpContext.Provider value={jump}>
          <div ref={scrollRef}>
            <div data-native-chat-message-id="reply-1">
              <p data-native-chat-quote-source="reply-1">The quoted text.</p>
            </div>
            {/* The user's own earlier message, drawn by the real row. */}
            <MessageRow
              message={{
                id: 'mine-earlier',
                role: 'user',
                timestamp: 0,
                source: 'transcript',
                blocks: [{ type: 'text', text: 'My earlier words.' }]
              }}
              expandSignal={false}
              onScrollMessageToTop={() => {}}
            />
            <div data-native-chat-message-id="mine">
              <NativeChatMarkdown content={content} variant="document" quoteChips />
            </div>
          </div>
        </NativeChatQuoteJumpContext.Provider>
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
}

function workspaces(...ids: string[]): AppState['worktreesByRepo'] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the history reads only each worktree's id.
  return { repo: ids.map((id) => ({ id })) } as unknown as AppState['worktreesByRepo']
}

/**
 * The file open as the real one does it: it takes a link-open turn, and later activates the file's
 * workspace while that turn is current. The activation records a visit unless the caller records
 * its own history.
 */
function fileOpensIn(workspaceId: string): void {
  mocks.open.mockImplementation(
    (_path: string, _line: number, _column: number, deps: { recordsHistory?: false }) => {
      const isCurrent = beginLinkOpenRequest()
      void Promise.resolve().then(() => {
        if (!isCurrent()) {
          return
        }
        mocks.landed(workspaceId)
        if (deps.recordsHistory !== false) {
          useAppStore.getState().recordWorktreeVisit(workspaceId)
        }
      })
    }
  )
}

function frames(count: number): void {
  for (let index = 0; index < count; index++) {
    act(() => vi.advanceTimersToNextFrame())
  }
}

function history(): { entries: unknown[]; index: number } {
  const state = useAppStore.getState()
  return { entries: state.worktreeNavHistory, index: state.worktreeNavHistoryIndex }
}

const PLACE = {
  kind: 'native-chat-quote',
  worktreeId: 'w1',
  tabId: 'tab-1',
  messageId: 'mine',
  chip: 1
} as const
const TAB: Tab = {
  id: 'tab-1',
  entityId: 'term-1',
  groupId: 'g1',
  worktreeId: 'w1',
  contentType: 'terminal',
  label: 'Chat',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
  registerWorktreeActivation(mocks.activate, mocks.activateView)
  useAppStore.setState({
    worktreesByRepo: workspaces('w0', 'w1'),
    worktreeNavHistory: ['w0', 'w1'],
    worktreeNavHistoryIndex: 1,
    unifiedTabsByWorktree: {
      w1: [TAB]
    }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  issue.mockReset()
  for (const mock of Object.values(mocks)) {
    mock.mockClear()
  }
})

it('goes Back from a quoted reply to its chip, and Forward to the reply again', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  const source = screen.getByText('The quoted text.', { selector: 'p' })

  fireEvent.click(chip)
  frames(2)
  expect(document.activeElement).toBe(source)
  // The chip's place stands in for its workspace entry.
  expect(history()).toEqual({
    entries: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }],
    index: 2
  })

  issue.mockClear()
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenCalledWith('w1', { navigationIntent: 'user-open' })
  expect(mocks.activateTab).toHaveBeenCalledWith('tab-1', { worktreeId: 'w1' })
  frames(3)
  expect(issue).toHaveBeenCalledWith({ kind: 'rail', messageId: 'mine', requestId: 1 })
  expect(document.activeElement).toBe(chip)
  expect(history().index).toBe(1)

  issue.mockClear()
  act(() => useAppStore.getState().goForwardWorktree())
  frames(5)
  expect(issue).toHaveBeenLastCalledWith({ kind: 'rail', messageId: 'reply-1', requestId: 1 })
  expect(document.activeElement).toBe(source)
  // Forward replays the jump; it adds no entry.
  expect(history()).toEqual({
    entries: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }],
    index: 2
  })
  expect(mocks.activateView).not.toHaveBeenCalled()
})

it("goes Back from the user's own quoted message to its chip, and Forward to it again", () => {
  rememberNativeChatQuoteSource('My earlier words.', { messageId: 'mine-earlier', place: null })
  render(<Chat content={'> My earlier words.\n\nmy words'} />, {
    wrapper: TranslationScopeProvider
  })
  const chip = screen.getByRole('button', { name: 'Quote: My earlier words.' })
  const source = document.querySelector('[data-native-chat-quote-source="mine-earlier"]')

  fireEvent.click(chip)
  frames(2)
  expect(source).not.toBeNull()
  expect(document.activeElement).toBe(source)
  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  expect(document.activeElement).toBe(chip)
  act(() => useAppStore.getState().goForwardWorktree())
  frames(5)
  expect(document.activeElement).toBe(source)
})

it('goes Back from a quoted file to its chip, and Forward opens the file again', () => {
  render(<Chat content={'> src/a.ts:12-14\n> ```ts\n> const a = 1\n> ```\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ })

  fireEvent.click(chip)
  expect(mocks.open).toHaveBeenCalledOnce()
  const place = { ...PLACE, chip: 0 }
  expect(history().entries).toEqual(['w0', { ...place, at: 'chip' }, { ...place, at: 'source' }])

  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  expect(document.activeElement).toBe(chip)

  act(() => useAppStore.getState().goForwardWorktree())
  frames(3)
  expect(mocks.open).toHaveBeenCalledTimes(2)
  expect(mocks.open).toHaveBeenLastCalledWith('/repo/src/a.ts', 12, 1, expect.anything())
  expect(history()).toEqual({
    entries: ['w0', { ...place, at: 'chip' }, { ...place, at: 'source' }],
    index: 2
  })
})

it('records nothing when the source is missing', () => {
  render(<Chat content={'> typed by hand\n\nmy words'} />)
  fireEvent.click(screen.getByRole('button', { name: 'Quote: typed by hand' }))
  expect(mocks.toast).toHaveBeenCalledWith('The source of this quote is not available.')
  expect(history()).toEqual({ entries: ['w0', 'w1'], index: 1 })
})

it('records no step for a chip whose source no older page has, so Forward pages nothing', () => {
  const startHistoryJump = vi.fn(
    (_target: unknown, settled?: (result: 'landed' | 'missing' | 'aborted') => void) =>
      settled?.('missing')
  )
  rememberNativeChatQuoteSource('Older words.', { messageId: 'not-loaded', place: null })
  render(<Chat content={'> Older words.\n\nmy words'} startHistoryJump={startHistoryJump} />)
  fireEvent.click(screen.getByRole('button', { name: 'Quote: Older words.' }))
  expect(mocks.toast).toHaveBeenCalledWith('The source of this quote is not available.')
  expect(history()).toEqual({ entries: ['w0', 'w1'], index: 1 })
  act(() => useAppStore.getState().goForwardWorktree())
  frames(5)
  expect(startHistoryJump).toHaveBeenCalledOnce()
})

it('keeps Back and Forward between workspaces, and skips the source of a closed chat', () => {
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenLastCalledWith('w0', { navigationIntent: 'user-open' })
  act(() => useAppStore.getState().goForwardWorktree())
  expect(mocks.activate).toHaveBeenLastCalledWith('w1', { navigationIntent: 'user-open' })
  expect(mocks.activateTab).not.toHaveBeenCalled()
  expect(history()).toEqual({ entries: ['w0', 'w1'], index: 1 })

  useAppStore.setState({
    worktreeNavHistory: ['w0', { ...PLACE, at: 'source' }, 'w1'],
    worktreeNavHistoryIndex: 2,
    unifiedTabsByWorktree: { w1: [] }
  })
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenLastCalledWith('w0', { navigationIntent: 'user-open' })
  expect(history().index).toBe(0)
})

it('goes Back to the chip when the file open records its workspace', async () => {
  fileOpensIn('w1')
  render(<Chat content={'> src/a.ts:12-14\n> ```ts\n> const a = 1\n> ```\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ })
  const place = { ...PLACE, chip: 0 }
  const entries = ['w0', { ...place, at: 'chip' }, { ...place, at: 'source' }]

  fireEvent.click(chip)
  await act(async () => {})
  expect(history()).toEqual({ entries, index: 2 })

  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  await act(async () => {})
  expect(history()).toEqual({ entries, index: 1 })
  expect(document.activeElement).toBe(chip)

  act(() => useAppStore.getState().goForwardWorktree())
  frames(3)
  await act(async () => {})
  expect(history()).toEqual({ entries, index: 2 })
})

it('records the next chip click after Forward replays a jump', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  fireEvent.click(chip)
  frames(2)
  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  act(() => useAppStore.getState().goForwardWorktree())
  frames(5)
  useAppStore.setState({ worktreeNavHistory: ['w0', 'w1'], worktreeNavHistoryIndex: 1 })

  fireEvent.click(chip)
  frames(2)
  expect(history()).toEqual({
    entries: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }],
    index: 2
  })
})

it('keeps the workspace of a closed chat reachable, and opens only the workspace', () => {
  useAppStore.setState({
    worktreeNavHistory: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }],
    worktreeNavHistoryIndex: 0,
    unifiedTabsByWorktree: { w1: [] }
  })
  act(() => useAppStore.getState().goForwardWorktree())
  frames(3)
  expect(mocks.activate).toHaveBeenCalledWith('w1', { navigationIntent: 'user-open' })
  expect(mocks.activateTab).not.toHaveBeenCalled()
  expect(issue).not.toHaveBeenCalled()
  // The source of a closed chat is not a step.
  expect(history().index).toBe(1)
  act(() => useAppStore.getState().goForwardWorktree())
  expect(history().index).toBe(1)
})

it('reopens a closed tab in the workspace of a chat place', () => {
  const reopenClosedTab = vi.fn(() => true)
  useAppStore.setState({
    worktreeNavHistory: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }],
    worktreeNavHistoryIndex: 2,
    reopenClosedTab
  })
  reopenClosedWorkspaceTab(null)
  expect(reopenClosedTab).toHaveBeenCalledWith('w1')
})

const FILE_QUOTE = '> src/a.ts:12-14\n> ```ts\n> const a = 1\n> ```\n\nmy words'
const FILE_PLACE = { ...PLACE, chip: 0 }

it('keeps the jump source when the file opens in another workspace, so Back reaches the chip', async () => {
  useAppStore.setState({ worktreesByRepo: workspaces('w0', 'w1', 'w2') })
  // The host maps the file to workspace w2.
  fileOpensIn('w2')
  render(<Chat content={FILE_QUOTE} />)
  const chip = screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ })
  const entries = ['w0', { ...FILE_PLACE, at: 'chip' }, { ...FILE_PLACE, at: 'source' }]

  fireEvent.click(chip)
  await act(async () => {})
  expect(mocks.landed).toHaveBeenCalledWith('w2')
  expect(history()).toEqual({ entries, index: 2 })

  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  await act(async () => {})
  expect(history()).toEqual({ entries, index: 1 })
  expect(document.activeElement).toBe(chip)

  act(() => useAppStore.getState().goForwardWorktree())
  frames(3)
  await act(async () => {})
  expect(mocks.landed).toHaveBeenCalledTimes(2)
  expect(history()).toEqual({ entries, index: 2 })
})

it('ignores the late landing of a jump after a newer Back', async () => {
  fileOpensIn('w2')
  render(<Chat content={FILE_QUOTE} />)
  const chip = screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ })
  const entries = ['w0', { ...FILE_PLACE, at: 'chip' }, { ...FILE_PLACE, at: 'source' }]

  fireEvent.click(chip)
  // Back comes before the file open lands.
  act(() => useAppStore.getState().goBackWorktree())
  await act(async () => {})
  frames(3)
  expect(mocks.landed).not.toHaveBeenCalled()
  expect(history()).toEqual({ entries, index: 1 })
  expect(document.activeElement).toBe(chip)
})

it('ignores the late highlight of a jump after a newer Back, and records no step for it', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  const source = screen.getByText('The quoted text.', { selector: 'p' })

  fireEvent.click(chip)
  // The jump has not shown its source yet, so Back leaves the workspace.
  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  expect(document.activeElement).not.toBe(source)
  expect(mocks.activate).toHaveBeenLastCalledWith('w0', { navigationIntent: 'user-open' })
  expect(history()).toEqual({ entries: ['w0', 'w1'], index: 0 })
})

it.each([
  ['shows a reply that is drawn late', false],
  ['ignores a reply that is drawn after a newer Back', true]
])('%s', (_name, back) => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  const source = screen.getByText('The quoted text.', { selector: 'p' })
  source.removeAttribute('data-native-chat-quote-source')

  fireEvent.click(chip)
  frames(5)
  if (back) {
    act(() => useAppStore.getState().goBackWorktree())
  }
  source.setAttribute('data-native-chat-quote-source', 'reply-1')
  frames(30)
  expect(document.activeElement === source).toBe(!back)
  expect(mocks.toast).not.toHaveBeenCalled()
})

it('ignores the late chip focus of a chat place after a newer link open', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  fireEvent.click(chip)
  frames(2)
  act(() => useAppStore.getState().goBackWorktree())
  // A link in another pane opens before the transcript shows the chip.
  beginLinkOpenRequest()
  frames(3)
  expect(document.activeElement).not.toBe(chip)
})

it('stops a pending jump on Back when the jump recorded no place', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(
    <Chat
      content={'> other\n\n> The quoted text.\n\nmy words'}
      owner={{ ...OWNER, fileLinkContext: { ...OWNER.fileLinkContext, sourceTabId: undefined } }}
    />
  )
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  const source = screen.getByText('The quoted text.', { selector: 'p' })
  source.removeAttribute('data-native-chat-quote-source')
  fireEvent.click(chip)
  frames(5)
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenCalledWith('w0', { navigationIntent: 'user-open' })
  source.setAttribute('data-native-chat-quote-source', 'reply-1')
  frames(30)
  expect(document.activeElement).not.toBe(source)
})

it('stops a pending jump on Back to a page when the jump recorded no place', () => {
  useAppStore.setState({
    worktreeNavHistory: ['automations', 'w1'],
    worktreeNavHistoryIndex: 1,
    unifiedTabsByWorktree: { w1: [] }
  })
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> The quoted text.\n\nmy words'} />)
  const source = screen.getByText('The quoted text.', { selector: 'p' })
  source.removeAttribute('data-native-chat-quote-source')
  fireEvent.click(screen.getByRole('button', { name: 'Quote: The quoted text.' }))
  frames(3)
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activateView).toHaveBeenCalledWith('automations')
  source.setAttribute('data-native-chat-quote-source', 'reply-1')
  frames(40)
  expect(document.activeElement).not.toBe(source)
})

it('ignores the late chip focus of a chat place after Back leaves it', () => {
  rememberNativeChatQuoteSource('The quoted text.', { messageId: 'reply-1', place: null })
  render(<Chat content={'> other\n\n> The quoted text.\n\nmy words'} />)
  const chip = screen.getByRole('button', { name: 'Quote: The quoted text.' })
  fireEvent.click(chip)
  frames(2)
  issue.mockClear()

  act(() => useAppStore.getState().goBackWorktree())
  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  expect(mocks.activate).toHaveBeenLastCalledWith('w0', { navigationIntent: 'user-open' })
  expect(issue).not.toHaveBeenCalled()
  expect(document.activeElement).not.toBe(chip)
})

it('keeps the Back of a workspace that shows the current workspace', () => {
  // A removed workspace between two visits of w1: Back still steps to the first one.
  useAppStore.setState({ worktreeNavHistory: ['w1', 'gone', 'w1'], worktreeNavHistoryIndex: 2 })
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenLastCalledWith('w1', { navigationIntent: 'user-open' })
  expect(history().index).toBe(0)
})

it('adds later workspace visits after a jump, and a page visit at the chip', () => {
  render(<Chat content={FILE_QUOTE} />)
  fireEvent.click(screen.getByRole('button', { name: /^Quote: src\/a\.ts:12-14/ }))
  act(() => useAppStore.getState().recordWorktreeVisit('w2'))
  act(() => useAppStore.getState().recordWorktreeVisit('w1'))
  expect(history()).toEqual({
    entries: ['w0', { ...FILE_PLACE, at: 'chip' }, { ...FILE_PLACE, at: 'source' }, 'w2', 'w1'],
    index: 4
  })

  useAppStore.setState({
    worktreeNavHistory: ['w0', { ...FILE_PLACE, at: 'chip' }, { ...FILE_PLACE, at: 'source' }],
    worktreeNavHistoryIndex: 1
  })
  act(() => useAppStore.getState().recordViewVisit('tasks'))
  act(() => useAppStore.getState().recordWorktreeVisit('w1'))
  expect(history()).toEqual({
    entries: ['w0', { ...FILE_PLACE, at: 'chip' }, 'tasks', 'w1'],
    index: 3
  })
})

it('keeps the index when the workspace of a chat place refuses to open', () => {
  useAppStore.setState({
    worktreeNavHistory: [
      'w0',
      { ...FILE_PLACE, at: 'chip' },
      { ...FILE_PLACE, at: 'source' },
      'w0'
    ],
    worktreeNavHistoryIndex: 3
  })
  mocks.activate.mockImplementation((id: string) => id !== 'w1')
  act(() => useAppStore.getState().goBackWorktree())
  frames(3)
  expect(mocks.activate).toHaveBeenLastCalledWith('w1', { navigationIntent: 'user-open' })
  expect(mocks.activateTab).not.toHaveBeenCalled()
  expect(history().index).toBe(3)
  mocks.activate.mockImplementation(() => true)
})

it('skips a step that shows the current view after the chat closes at its source', () => {
  useAppStore.setState({
    worktreeNavHistory: ['w0', { ...FILE_PLACE, at: 'chip' }, { ...FILE_PLACE, at: 'source' }],
    worktreeNavHistoryIndex: 2,
    unifiedTabsByWorktree: { w1: [] }
  })
  act(() => useAppStore.getState().goBackWorktree())
  expect(mocks.activate).toHaveBeenLastCalledWith('w0', { navigationIntent: 'user-open' })
  expect(history().index).toBe(0)
  act(() => useAppStore.getState().goForwardWorktree())
  act(() => useAppStore.getState().goForwardWorktree())
  expect(history().index).toBe(1)
})

it('does not walk between two chip places of a closed chat', () => {
  const other = { ...PLACE, chip: 0 }
  useAppStore.setState({
    worktreeNavHistory: [
      'w0',
      { ...other, at: 'chip' },
      { ...other, at: 'source' },
      { ...PLACE, at: 'chip' },
      { ...PLACE, at: 'source' }
    ],
    worktreeNavHistoryIndex: 3,
    unifiedTabsByWorktree: { w1: [] }
  })
  act(() => useAppStore.getState().goBackWorktree())
  expect(history().index).toBe(0)
  act(() => useAppStore.getState().goForwardWorktree())
  expect(history().index).toBe(1)
  act(() => useAppStore.getState().goForwardWorktree())
  expect(history().index).toBe(1)
  expect(mocks.activate).toHaveBeenCalledTimes(2)
})

it('skips the chat places of a removed workspace', () => {
  useAppStore.setState({
    worktreesByRepo: workspaces('w0', 'w2'),
    worktreeNavHistory: ['w0', { ...PLACE, at: 'chip' }, { ...PLACE, at: 'source' }, 'w2'],
    worktreeNavHistoryIndex: 3
  })
  act(() => useAppStore.getState().goBackWorktree())
  expect(history().index).toBe(0)
  act(() => useAppStore.getState().goForwardWorktree())
  expect(history().index).toBe(3)
  expect(mocks.activateTab).not.toHaveBeenCalled()
})
