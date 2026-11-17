import { describe, expect, it } from 'vitest'

import { getScreenSubmitShortcutLabel } from '../../../../lib/keyboard/screen-submit-shortcut'
import { nativeChatComposerPlaceholder } from './native-chat-composer-placeholder'

describe('nativeChatComposerPlaceholder', () => {
  it('names the send key only while Cmd/Ctrl+Enter sends', () => {
    const shortcut = getScreenSubmitShortcutLabel()
    expect(nativeChatComposerPlaceholder(true, true)).not.toContain(shortcut)
    expect(nativeChatComposerPlaceholder(true, true, undefined, undefined, true)).toBe(
      `Ask anything, @ to mention files, / for commands, ${shortcut} to send`
    )
  })
})
