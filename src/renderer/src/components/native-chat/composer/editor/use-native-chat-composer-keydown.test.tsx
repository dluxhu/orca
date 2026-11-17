// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useNativeChatRecallPosition } from '../../drafts/use-native-chat-composer-recall'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import { getDefaultSettings } from '../../../../../../shared/constants'
import { useAppStore } from '@/store'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'

describe('useNativeChatComposerKeyDown', () => {
  describe('prompt recall', () => {
    const userMessage = (id: string, text: string): NativeChatMessage => ({
      id,
      role: 'user',
      blocks: [{ type: 'text', text }],
      timestamp: null,
      source: 'transcript'
    })

    const onEveryEdge = (): boolean => true

    function Composer({
      prompts,
      initialDraft = '',
      hasAttachments,
      isCaretOnVisualEdge = onEveryEdge
    }: {
      prompts: string[]
      initialDraft?: string
      hasAttachments?: boolean
      isCaretOnVisualEdge?: (edge: 'start' | 'end') => boolean
    }): React.JSX.Element {
      const [draft, setDraft] = useState(initialDraft)
      const [recallPosition, setRecallPosition] = useNativeChatRecallPosition(draft)
      const onKeyDown = useNativeChatComposerKeyDown({
        autocomplete: { mode: 'none' },
        activeSuggestion: 0,
        draft,
        mentionFiles: { files: [], loading: false, failed: false },
        completeMention: vi.fn(),
        recall: {
          source: { messages: prompts.map((text, index) => userMessage(String(index), text)) },
          position: recallPosition,
          setPosition: setRecallPosition,
          isCaretOnVisualEdge,
          show: vi.fn()
        },
        isComposing: () => false,
        completePickerItem: vi.fn(),
        dispatchPickerCommand: vi.fn(),
        dismissPicker: vi.fn(),
        interrupt: vi.fn(),
        send: vi.fn(),
        setActiveSuggestion: vi.fn(),
        setDraft,
        setCaret: vi.fn(),
        ...(hasAttachments === undefined ? {} : { hasAttachments })
      })
      return (
        <textarea
          aria-label="composer"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )
    }

    function setup(props: Parameters<typeof Composer>[0]) {
      const field = render(<Composer {...props} />).container.querySelector('textarea')!
      return {
        field,
        press: (key: string, init: KeyboardEventInit = {}) => {
          const claimed = !fireEvent.keyDown(field, { key, ...init })
          return { draft: field.value, claimed }
        }
      }
    }

    it('treats an edited recall as a typed draft', () => {
      const { field, press } = setup({ prompts: ['one', 'two'] })
      press('ArrowUp')
      fireEvent.change(field, { target: { value: 'two, edited' } })
      expect(press('ArrowUp')).toEqual({ draft: 'two, edited', claimed: false })
      // Edited back to the recalled text, it is still a typed draft.
      fireEvent.change(field, { target: { value: 'two' } })
      expect(press('ArrowUp')).toEqual({ draft: 'two', claimed: false })
    })
  })

  describe('steer chord', () => {
    function Composer({
      initialDraft,
      chordSteersHead,
      send,
      steerHead
    }: {
      initialDraft: string
      chordSteersHead: boolean
      send: (intent?: { alternate?: boolean }) => void
      steerHead: () => boolean
    }): React.JSX.Element {
      const [draft, setDraft] = useState(initialDraft)
      const onKeyDown = useNativeChatComposerKeyDown({
        autocomplete: { mode: 'none' },
        activeSuggestion: 0,
        draft,
        mentionFiles: { files: [], loading: false, failed: false },
        completeMention: vi.fn(),
        isComposing: () => false,
        completePickerItem: vi.fn(),
        dispatchPickerCommand: vi.fn(),
        dismissPicker: vi.fn(),
        interrupt: vi.fn(),
        send,
        steerHead,
        chordSteersHead,
        setActiveSuggestion: vi.fn(),
        setDraft,
        setCaret: vi.fn()
      })
      return (
        <textarea aria-label="composer" value={draft} onChange={() => {}} onKeyDown={onKeyDown} />
      )
    }

    function pressModEnter(
      initialDraft: string,
      { chordSteersHead = true, ...init }: KeyboardEventInit & { chordSteersHead?: boolean } = {}
    ) {
      const send = vi.fn()
      const steerHead = vi.fn(() => true)
      const field = render(
        <Composer
          initialDraft={initialDraft}
          chordSteersHead={chordSteersHead}
          send={send}
          steerHead={steerHead}
        />
      ).container.querySelector('textarea')!
      // Both modifiers: the platform picks which one is the chord's.
      fireEvent.keyDown(field, { key: 'Enter', metaKey: true, ctrlKey: true, ...init })
      return { send, steerHead }
    }

    it('steers the head card from an empty composer, once per press, only where the chord steers', () => {
      const { send, steerHead } = pressModEnter('')
      expect(steerHead).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalled()
      expect(pressModEnter('', { repeat: true }).steerHead).not.toHaveBeenCalled()
      // With follow-ups off the chord queues, so a second press never steers the card just queued.
      expect(pressModEnter('', { chordSteersHead: false }).steerHead).not.toHaveBeenCalled()
      expect(pressModEnter('steer this').steerHead).not.toHaveBeenCalled()
    })
  })

  describe('send key', () => {
    afterEach(() => useAppStore.setState({ settings: null }))

    const slashMenu: ComposerAutocomplete = {
      mode: 'slash',
      query: '',
      items: [
        {
          kind: 'command',
          id: 'command:review',
          name: 'review',
          token: '/review',
          skillCollision: false
        }
      ],
      triggerKey: '/',
      prefix: '/',
      dispatchable: true,
      grouped: false,
      commandsEnabled: true,
      skillsEnabled: false,
      skillStatus: 'ready'
    }

    function press(
      init: KeyboardEventInit,
      {
        sendWithModEnter,
        draft = 'hello',
        composing = false,
        menuOpen = false
      }: {
        sendWithModEnter: boolean
        draft?: string
        composing?: boolean
        menuOpen?: boolean
      }
    ) {
      useAppStore.setState({
        settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithModEnter: sendWithModEnter }
      })
      const send = vi.fn()
      const steerHead = vi.fn(() => true)
      const dispatchPickerCommand = vi.fn()
      function Composer(): React.JSX.Element {
        const onKeyDown = useNativeChatComposerKeyDown({
          autocomplete: menuOpen ? slashMenu : { mode: 'none' },
          activeSuggestion: 0,
          draft,
          mentionFiles: { files: [], loading: false, failed: false },
          completeMention: vi.fn(),
          isComposing: () => composing,
          completePickerItem: vi.fn(),
          dispatchPickerCommand,
          dismissPicker: vi.fn(),
          interrupt: vi.fn(),
          send,
          steerHead,
          chordSteersHead: true,
          setActiveSuggestion: vi.fn(),
          setDraft: vi.fn(),
          setCaret: vi.fn()
        })
        return (
          <textarea aria-label="composer" value={draft} onChange={() => {}} onKeyDown={onKeyDown} />
        )
      }
      const field = render(<Composer />).container.querySelector('textarea')!
      const claimed = !fireEvent.keyDown(field, { key: 'Enter', ...init })
      return { claimed, send, steerHead, dispatchPickerCommand }
    }

    // Both modifiers: the platform picks which one is the chord's.
    const mod = { metaKey: true, ctrlKey: true }

    it('keeps the default keys while the option is off', () => {
      const off = { sendWithModEnter: false }
      const enter = press({}, off)
      expect(enter.claimed).toBe(true)
      expect(enter.send.mock.calls).toEqual([[]])
      const shiftEnter = press({ shiftKey: true }, off)
      expect(shiftEnter.claimed).toBe(false)
      expect(shiftEnter.send).not.toHaveBeenCalled()
      expect(press(mod, off).send.mock.calls).toEqual([[{ alternate: true }]])
      expect(press({ ...mod, altKey: true }, off).send.mock.calls).toEqual([[{ alternate: true }]])
      expect(press({ ...mod, shiftKey: true }, off).steerHead).toHaveBeenCalledTimes(1)
    })

    it('makes Enter a new line and Cmd/Ctrl+Enter the send while the option is on', () => {
      const on = { sendWithModEnter: true }
      for (const init of [{}, { shiftKey: true }, { altKey: true }]) {
        const newLine = press(init, on)
        // Unclaimed: the editor inserts the new line itself.
        expect(newLine.claimed).toBe(false)
        expect(newLine.send).not.toHaveBeenCalled()
      }
      const modEnter = press(mod, on)
      expect(modEnter.claimed).toBe(true)
      expect(modEnter.send.mock.calls).toEqual([[]])
      // An empty composer sends as Enter does with the option off; it never steers the head card.
      const empty = press(mod, { ...on, draft: '' })
      expect(empty.send.mock.calls).toEqual([[]])
      expect(empty.steerHead).not.toHaveBeenCalled()
    })

    it('moves the other way of sending to Cmd/Ctrl+Alt+Enter while the option is on', () => {
      const on = { sendWithModEnter: true }
      const alt = { ...mod, altKey: true }
      expect(press(alt, on).send.mock.calls).toEqual([[{ alternate: true }]])
      const empty = press(alt, { ...on, draft: '' })
      expect(empty.send).not.toHaveBeenCalled()
      expect(empty.steerHead).toHaveBeenCalledTimes(1)
      const steer = press({ ...mod, shiftKey: true }, on)
      expect(steer.send).not.toHaveBeenCalled()
      expect(steer.steerHead).toHaveBeenCalledTimes(1)
    })

    it.each([false, true])('picks the menu item with Enter, option on: %s', (sendWithModEnter) => {
      const picked = press({}, { sendWithModEnter, menuOpen: true })
      expect(picked.claimed).toBe(true)
      expect(picked.dispatchPickerCommand).toHaveBeenCalledTimes(1)
      expect(picked.send).not.toHaveBeenCalled()
    })

    it.each([false, true])(
      'lets an IME composition commit with Enter, never send, option on: %s',
      (sendWithModEnter) => {
        for (const init of [{}, mod]) {
          const composed = press(init, { sendWithModEnter, composing: true })
          expect(composed.claimed).toBe(true)
          expect(composed.send).not.toHaveBeenCalled()
        }
      }
    )
  })
})
