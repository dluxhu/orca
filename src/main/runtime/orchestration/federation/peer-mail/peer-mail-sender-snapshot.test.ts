import { describe, expect, it } from 'vitest'
import { readAnswerSenderSnapshot } from '../../../../../shared/agent-session/journal/answer-sender-snapshot'
import { peerMailSenderSnapshot } from './peer-mail-sender-snapshot'

const CHAT = 'orca_session_id:0d31576f-309e-42f7-8cf4-7e79e47a2cc2'
const originOf = (address: string, hostId: string, own: string | undefined) =>
  readAnswerSenderSnapshot(
    peerMailSenderSnapshot('label', { name: 'Lead', computer: 'Box', address, hostId }, own)
  )?.origin

describe('peerMailSenderSnapshot origin', () => {
  it("keeps the sender's chat or terminal on another Orca", () => {
    expect(originOf(CHAT, 'install-a', 'install-b')).toEqual({ hostId: 'install-a', address: CHAT })
    expect(originOf('term_a1', 'install-a', 'install-b')).toEqual({
      hostId: 'install-a',
      address: 'term_a1'
    })
  })

  it('drops an origin that names this Orca, or that it cannot check', () => {
    expect(originOf(CHAT, 'install-b', 'install-b')).toBeUndefined()
    expect(originOf(CHAT, 'install-a', undefined)).toBeUndefined()
  })

  it('drops an address that is not a chat or terminal address', () => {
    expect(originOf('dispatch:ctx_1', 'install-a', 'install-b')).toBeUndefined()
    expect(originOf('../etc', 'install-a', 'install-b')).toBeUndefined()
  })
})
