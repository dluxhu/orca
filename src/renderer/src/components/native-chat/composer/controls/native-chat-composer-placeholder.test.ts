// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
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

  const base = { hasPty: true, canSend: true, editing: false, goal: false }

  it('follows the setting', () => {
    const placeholder = renderHook(() => useNativeChatComposerPlaceholder(base))
    expect(placeholder.result.current).not.toContain(getScreenSubmitShortcutLabel())
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: true }
    })
    placeholder.rerender()
    expect(placeholder.result.current).toContain(`${getScreenSubmitShortcutLabel()} to send`)
  })

  it('names the send key in the edit and goal placeholders, not in a disabled reason', () => {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: true }
    })
    const shortcut = getScreenSubmitShortcutLabel()
    const placeholder = (args: Partial<typeof base> & { hint?: string }) =>
      renderHook(() => useNativeChatComposerPlaceholder({ ...base, ...args })).result.current
    expect(placeholder({ editing: true })).toBe(`Edit message, ${shortcut} to save`)
    const goal = 'Describe your goal, define measurable outcomes for best results'
    expect(placeholder({ goal: true })).toBe(`${goal}, ${shortcut} to send`)
    expect(placeholder({ hint: 'Install the agent' })).toBe('Install the agent')
    useAppStore.setState({ settings: getDefaultSettings('/tmp') })
    expect(placeholder({ goal: true })).toBe(goal)
  })
})
