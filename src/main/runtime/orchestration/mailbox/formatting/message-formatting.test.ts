import { describe, expect, it } from 'vitest'
import type { MessageRow } from '../../db/orchestration-records'
import { formatMessageBanner } from './message-formatting'

function row(fields: Partial<MessageRow>): MessageRow {
  return {
    id: 'msg_1',
    run_id: 'run_1',
    from_handle: 'dispatch:d1',
    to_handle: 'term_coordinator',
    subject: 'Re: Question',
    body: 'Use the second plan.',
    type: 'status',
    priority: 'normal',
    thread_id: null,
    payload: null,
    read: 0,
    sequence: 1,
    created_at: '2026-11-21 10:00:00',
    delivered_at: null,
    sender_pane_key: null,
    ...fields
  }
}

const snapshot = (address: string, name: string) =>
  JSON.stringify({
    version: 1,
    sender: { party: { address, terminalHandle: null, orcaSessionId: null }, name }
  })

describe('formatMessageBanner sender name', () => {
  it('names a locally accepted answer by the name saved with it', () => {
    const banner = formatMessageBanner(
      row({ answer_sender_snapshot: snapshot('dispatch:d1', 'Tech Lead') })
    )
    expect(banner).toContain('From: Tech Lead (dispatch:d1)')
  })

  it('keeps the handle when the saved name is for another party or is missing', () => {
    expect(
      formatMessageBanner(row({ answer_sender_snapshot: snapshot('dispatch:d2', 'Other') }))
    ).toContain('From: DISPATCH:D1 (dispatch:d1)')
    expect(formatMessageBanner(row({}))).toContain('From: DISPATCH:D1 (dispatch:d1)')
  })
})
