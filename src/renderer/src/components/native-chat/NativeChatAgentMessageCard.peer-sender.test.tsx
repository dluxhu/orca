// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from './messages/actions/native-chat-tooltip-test-harness'
import { useAppStore } from '@/store'
import {
  initialStore,
  resetSenderStore
} from './messages/agent-senders/native-chat-agent-sender.test-fixture'
import { MessageRow } from './messages/rows/NativeChatMessageRow'
import { useAgentMessageSenderLabel } from './messages/agent-senders/native-chat-agent-message-sender-label'
import { readAgentMessageSource } from '../../../../shared/agent-session/journal/agent-session-message-source'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { makeUnifiedTab } from '@/store/slices/tabs/tab-group.test-fixture'
import { openOrchestrationDispatch } from '@/lib/agent-session/open/open-agent-message-sender'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/agent-session/open/open-agent-message-sender', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openOrchestrationDispatch: vi.fn(async () => {})
}))

vi.mock('@/components/agent/icons/agent-type-icon', () => ({
  AgentTypeIcon: ({ agentType }: { agentType: string | null | undefined }) => (
    <span data-testid="agent-icon">{agentType ?? '?'}</span>
  )
}))

beforeEach(() => resetSenderStore())

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAppStore.setState(initialStore, true)
})

// The sender as peer mail stores it: the label is the party, named by what the other computer sent.
function renderPeerMail(sender: Record<string, unknown>): void {
  const from = readAgentMessageSource({
    kind: 'agent',
    senders: [
      {
        party: {
          address: "orca_session_id:0d31576f-309e-42f7-8cf4-7e79e47a2cc2 on Alice's Mac",
          terminalHandle: null,
          orcaSessionId: null
        },
        host: "Alice's Mac",
        ...sender
      }
    ],
    orchestration: { message: 'mail-notice', mailbox: 'term_9', dispatchId: null, messages: [] }
  })!
  render(
    <MessageRow
      message={{
        id: 'peer',
        role: 'user',
        blocks: [{ type: 'text', text: 'Where is the install guide?' }],
        timestamp: 1,
        source: 'transcript',
        from
      }}
      expandSignal={false}
      onScrollMessageToTop={() => {}}
      runtimeContext={{ worktreeId: 'workspace', worktreePath: null, target: { kind: 'local' } }}
    />
  )
}

it("shows another computer's bot by its name and carried avatar, with that computer's pill", () => {
  renderPeerMail({ name: 'Bot builder', bot: true, botAvatar: 'mascot:A1', agent: 'claude' })

  expect(screen.getByText('Bot builder')).toBeInTheDocument()
  expect(screen.getByText("Alice's Mac")).toBeInTheDocument()
  expect(screen.queryByTestId('agent-icon')).not.toBeInTheDocument()
  expect(document.querySelector('img[src*="A1"]')).not.toBeNull()
})

const ORIGIN_SESSION = '7a5f0c64-3c55-4b9f-9d0b-4c2e8d1f6a10'
const origin = { hostId: 'install-b', address: `orca_session_id:${ORIGIN_SESSION}` }

function connectOrcaB(): void {
  useAppStore.setState({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lookup reads only the installation id of the status.
    runtimeStatusByEnvironmentId: new Map([
      ['env-b', { status: { hostDescriptor: { installationId: 'install-b' } } }]
    ]) as unknown as ReturnType<typeof useAppStore.getState>['runtimeStatusByEnvironmentId']
  })
}

function openChatOnOrcaB(): void {
  useAppStore.setState({
    unifiedTabsByWorktree: {
      remote: [
        makeUnifiedTab({
          id: 'chat-b',
          entityId: ORIGIN_SESSION,
          worktreeId: 'remote',
          groupId: 'g',
          contentType: 'agent-session',
          executionHostId: toRuntimeExecutionHostId('env-b'),
          customLabel: 'Live name'
        })
      ]
    }
  })
}

it('names a chat on another Orca from that Orca, and opens it there', async () => {
  openChatOnOrcaB()
  connectOrcaB()
  renderPeerMail({ name: 'Sent name', agent: 'claude', origin })

  const link = screen.getByRole('button', { name: 'Open Live name' })
  await userEvent.click(link)

  expect(openOrchestrationDispatch).toHaveBeenCalledWith(
    origin.address,
    'Live name',
    { kind: 'environment', environmentId: 'env-b' },
    expect.anything()
  )
})

it('uses the sent name, and says so when this window is not connected to its Orca', async () => {
  renderPeerMail({ name: 'Sent name', agent: 'claude', origin })

  await userEvent.click(screen.getByRole('button', { name: 'Open Sent name' }))

  expect(openOrchestrationDispatch).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('not connected'))
})

it('renames the card when its Orca connects after the card shows', async () => {
  openChatOnOrcaB()
  renderPeerMail({ name: 'Sent name', agent: 'claude', origin })
  expect(screen.getByRole('button', { name: 'Open Sent name' })).toBeInTheDocument()

  act(() => connectOrcaB())

  expect(await screen.findByRole('button', { name: 'Open Live name' })).toBeInTheDocument()
})

it('does not wake a sender without an origin on host status changes', () => {
  const [sender] = readAgentMessageSource({
    kind: 'agent',
    senders: [
      { party: { address: 'term_1', terminalHandle: 'term_1', orcaSessionId: null }, name: 'Local' }
    ]
  })!.senders
  let renders = 0
  renderHook(() => {
    renders += 1
    return useAgentMessageSenderLabel(sender!, 'workspace', { kind: 'local' })
  })
  const before = renders

  act(() => connectOrcaB())

  expect(renders).toBe(before)
})
