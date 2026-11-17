// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDefaultSettings } from '../../../../../../shared/constants'
import { useAppStore } from '@/store'
import { getScreenSubmitAltShortcutLabel } from '@/lib/keyboard/screen-submit-shortcut'
import { isMacPlatform } from '../../pane/routing/native-chat-shortcut'
import { NativeChatComposerActions } from './NativeChatComposerActions'
import { useNativeChatSteerChordPreview } from './use-native-chat-steer-chord-preview'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useAppStore.setState({ settings: null })
})

describe('send key with Cmd/Ctrl+Enter sending', () => {
  it('names Cmd/Ctrl+Alt+Enter as the other way of sending', () => {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: true }
    })
    render(
      <NativeChatComposerActions
        attachDisabled={false}
        dictationDisabled={false}
        sendDisabled={false}
        isWorking
        hasDraft
        alternateSend="steer"
        isDictating={false}
        isDictationHoldMode={false}
        onAttach={vi.fn()}
        onDictationToggle={vi.fn()}
        onDictationHoldStart={vi.fn()}
        onDictationHoldEnd={vi.fn()}
        onSend={vi.fn()}
        sessionOptionsSurface={null}
        sessionOptionsSnapshot={[]}
      />
    )
    expect(screen.getByText(`${getScreenSubmitAltShortcutLabel()} to steer`)).toBeTruthy()
  })

  function Preview(): React.JSX.Element {
    const root = useRef<HTMLDivElement>(null)
    const { preview } = useNativeChatSteerChordPreview(
      root,
      { alternateSend: 'steer', hasDraft: true, chordSteersHead: false },
      undefined,
      vi.fn(),
      { mode: 'none' }
    )
    return (
      <div ref={root} tabIndex={-1} data-testid="root">
        {preview ?? 'none'}
      </div>
    )
  }

  function holdChordKey(sendWithModEnter: boolean): string {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: sendWithModEnter }
    })
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<Preview />)
    const root = screen.getByTestId('root')
    fireEvent.keyDown(root, { key: isMacPlatform() ? 'Meta' : 'Control' })
    act(() => vi.advanceTimersByTime(200))
    return root.textContent ?? ''
  }

  it('previews the other way on a held Cmd/Ctrl only while Enter sends', () => {
    expect(holdChordKey(false)).toBe('steer')
    cleanup()
    expect(holdChordKey(true)).toBe('none')
  })
})
