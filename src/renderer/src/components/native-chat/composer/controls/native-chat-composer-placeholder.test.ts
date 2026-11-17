// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { getDefaultSettings } from '../../../../../../shared/constants'
import { getScreenSubmitShortcutLabel } from '../../../../lib/keyboard/screen-submit-shortcut'
import { useAppStore } from '../../../../store'
import {
  nativeChatComposerPlaceholder,
  useNativeChatComposerPlaceholder
} from './native-chat-composer-placeholder'

afterEach(() => useAppStore.setState({ settings: null }))

describe('nativeChatComposerPlaceholder', () => {
  it('names the send key only while Cmd/Ctrl+Enter sends', () => {
    const shortcut = getScreenSubmitShortcutLabel()
    expect(nativeChatComposerPlaceholder(true, true)).not.toContain(shortcut)
    expect(nativeChatComposerPlaceholder(true, true, undefined, undefined, true)).toBe(
      `Ask anything, @ to mention files, / for commands, ${shortcut} to send`
    )
  })

  it('follows the setting', () => {
    const placeholder = renderHook(() => useNativeChatComposerPlaceholder(true, true))
    expect(placeholder.result.current).not.toContain(getScreenSubmitShortcutLabel())
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: true }
    })
    placeholder.rerender()
    expect(placeholder.result.current).toContain(`${getScreenSubmitShortcutLabel()} to send`)
  })
})
