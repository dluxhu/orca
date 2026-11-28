// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_USAGE_TEMPLATE, StatusBarUsageFormatSetting } from './StatusBarUsageFormatSetting'

vi.mock('../../../store/index', () => ({
  useAppStore: (select: (state: { usagePercentageDisplay: 'used' }) => unknown) =>
    select({ usagePercentageDisplay: 'used' })
}))

afterEach(cleanup)

function field(): HTMLInputElement {
  const input = screen.getByRole('textbox')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('expected an input')
  }
  return input
}

it('fills an empty setting with the default template, not a placeholder example', () => {
  render(<StatusBarUsageFormatSetting format={{ template: '' }} onChange={() => {}} />)
  expect(field().value).toBe(DEFAULT_USAGE_TEMPLATE)
  expect(field().placeholder).toBe('')
  // No Reset while nothing is saved: the bar still uses the built-in rendering.
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
})

it('shows a saved template as is', () => {
  render(<StatusBarUsageFormatSetting format={{ template: '{5h}' }} onChange={() => {}} />)
  expect(field().value).toBe('{5h}')
})

it('keeps a cleared field empty while typing, and Reset brings the default back', () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <StatusBarUsageFormatSetting format={{ template: '{5h}' }} onChange={onChange} />
  )
  fireEvent.change(field(), { target: { value: '' } })
  expect(onChange).toHaveBeenLastCalledWith({ template: '' })
  rerender(<StatusBarUsageFormatSetting format={{ template: '' }} onChange={onChange} />)
  expect(field().value).toBe('')

  fireEvent.change(field(), { target: { value: '{7d}' } })
  rerender(<StatusBarUsageFormatSetting format={{ template: '{7d}' }} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(onChange).toHaveBeenLastCalledWith({ template: '' })
  expect(field().value).toBe(DEFAULT_USAGE_TEMPLATE)
})
