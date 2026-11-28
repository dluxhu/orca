import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'
import { openOrchestrationDispatch } from './open-agent-message-sender'
import { showChatOpenUnavailable } from './chat-open-failure-toast'
import { openOrcaAddress } from './open-on-orca-host'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))
vi.mock('./open-agent-message-sender', () => ({ openOrchestrationDispatch: vi.fn(async () => {}) }))
vi.mock('./chat-open-failure-toast', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showChatOpenUnavailable: vi.fn()
}))

afterEach(() => {
  vi.clearAllMocks()
})

it('shows the shared chat open toast when the linked chat does not open', async () => {
  await openOrcaAddress({ kind: 'local' }, 'orca_session_id:chat_aaaaaaaa', 'Tech Lead')
  const feedback = vi.mocked(openOrchestrationDispatch).mock.calls[0]?.[3]
  const context = { detail: 'session_not_found', retry: vi.fn() }
  feedback?.open?.unavailable('Tech Lead', context)

  expect(showChatOpenUnavailable).toHaveBeenCalledWith(context, 'Tech Lead')
  expect(toast.info).not.toHaveBeenCalled()
})
