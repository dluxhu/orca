import { describe, expect, it } from 'vitest'
import { removeMentionToken } from './native-chat-composer-autocomplete'

describe('removeMentionToken', () => {
  it('deletes only the @ token before the caret', () => {
    expect(removeMentionToken('ask @rel now', 8)).toEqual({ draft: 'ask  now', caret: 4 })
    expect(removeMentionToken('@rel', 4)).toEqual({ draft: '', caret: 0 })
    expect(removeMentionToken('mail a@b', 8)).toEqual({ draft: 'mail a@b', caret: 8 })
  })
})
