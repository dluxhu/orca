// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Bot } from '../../../../shared/bot-types'
import { useBotMentionTargets } from './use-bot-mention-targets'

const SERVER_HOST = 'runtime:env_s'

const bots = [
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lookup reads only these fields.
  { id: 'lead-1', name: 'Tech Lead', hostId: 'local', paused: false } as Bot
]

vi.mock('@/lib/bot-catalog', () => ({ useBots: () => bots, useBotsEnabled: () => true }))
vi.mock('@/lib/bot-catalog-snapshot', () => ({
  readBotHostIds: () => ['local', SERVER_HOST],
  readBotHostListed: () => true,
  subscribeToBotChanges: () => () => undefined
}))
vi.mock('./use-paired-server-client-mentions', () => ({ useOwnInstallation: () => 'inst-1' }))
vi.mock('./BotAvatar', () => ({ BotAvatar: () => null }))

describe("a paired server's chat looks up a bot on a paired computer", () => {
  it("finds this computer's bot when the token names this computer", () => {
    const { result } = renderHook(() => useBotMentionTargets(SERVER_HOST))
    expect(result.current('lead-1', undefined, 'inst-1')?.name).toBe('Tech Lead')
  })

  it('does not call a bot of another computer missing', () => {
    const { result } = renderHook(() => useBotMentionTargets(SERVER_HOST))
    expect(result.current('lead-1', undefined, 'inst-2')).toBeUndefined()
  })
})
