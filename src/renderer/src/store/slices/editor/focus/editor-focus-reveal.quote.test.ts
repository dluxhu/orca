// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { scheduleEditorLineReveal } from './editor-focus-reveal'
import type { AppState } from '../../../types'

afterEach(() => vi.useRealTimers())

it('passes a highlight length to the editor reveal, and none by default', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  const setPendingEditorReveal = vi.fn()
  const get = () => ({ setPendingEditorReveal }) as unknown as AppState
  scheduleEditorLineReveal(get, '/repo/a.ts', 12, 1, 'file-1', { matchLength: 40 })
  vi.advanceTimersToNextFrame()
  vi.advanceTimersToNextFrame()
  expect(setPendingEditorReveal).toHaveBeenLastCalledWith(
    expect.objectContaining({ line: 12, matchLength: 40 })
  )
  scheduleEditorLineReveal(get, '/repo/a.ts', 3)
  vi.advanceTimersToNextFrame()
  vi.advanceTimersToNextFrame()
  expect(setPendingEditorReveal).toHaveBeenLastCalledWith(
    expect.objectContaining({ line: 3, matchLength: 0 })
  )
})
