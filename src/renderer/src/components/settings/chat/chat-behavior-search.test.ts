import { describe, expect, it } from 'vitest'

import { getScreenSubmitAltShortcutLabel } from '@/lib/keyboard/screen-submit-shortcut'
import { getQueueFollowUpsDescription } from './chat-behavior-search'

describe('getQueueFollowUpsDescription', () => {
  it('names the chord that sends the other way', () => {
    expect(getQueueFollowUpsDescription(false)).toContain('Cmd/Ctrl+Enter does the opposite')
    const on = getQueueFollowUpsDescription(true)
    expect(on).toContain(`${getScreenSubmitAltShortcutLabel()} does the opposite`)
    expect(on).not.toContain('Cmd/Ctrl+Enter')
  })
})
