import { describe, expect, it } from 'vitest'
import type {
  ProviderRateLimits,
  RateLimitWindow
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { buildUsageFormatValues, renderUsageFormatTemplate } from './usage-format-template'

const now = Date.UTC(2026, 0, 1, 12)
const hour = 60 * 60 * 1000
// 5h window, 2h left: 3h of 5h (60%) has passed.
const session: RateLimitWindow = {
  usedPercent: 45.4,
  windowMinutes: 300,
  resetsAt: now + 2 * hour,
  resetDescription: null
}

function render(
  template: string,
  limits: Partial<ProviderRateLimits> = {},
  display: 'used' | 'remaining' = 'used'
): string {
  const p: ProviderRateLimits = {
    provider: 'claude',
    session,
    weekly: null,
    updatedAt: now,
    error: null,
    status: 'ok',
    ...limits
  }
  return renderUsageFormatTemplate(
    template,
    buildUsageFormatValues(p, { display, now, timeZone: 'UTC', locale: 'en-US' })
  )
}

describe('window time placeholders', () => {
  it('fills {5h.passed} and {5h.total}', () => {
    expect(render('{5h.passed}')).toBe('60%')
    expect(render('{5h.total}')).toBe('5h')
  })

  it('renders a usage-of-time-passed template', () => {
    expect(render('{5h} of {5h.passed} {5h.reset}')).toBe('45% of 60% 2h')
  })

  it('works for the weekly and Fable windows', () => {
    const weekly = { ...session, windowMinutes: 10080, resetsAt: now + 42 * hour }
    expect(render('{7d.passed} {7d.total}', { weekly })).toBe('75% 7d')
    expect(render('{fable.passed} {fable.total}', { fableWeekly: weekly })).toBe('75% 7d')
  })

  it('rounds like the usage percentage and clamps to 0..100', () => {
    // 3h 1.5m of 5h = 60.5% rounds up, as usage does.
    expect(
      render('{5h.passed}', { session: { ...session, resetsAt: now + 2 * hour - 90_000 } })
    ).toBe('61%')
    expect(render('{5h.passed}', { session: { ...session, resetsAt: now + 9 * hour } })).toBe('0%')
    expect(render('{5h.passed}', { session: { ...session, resetsAt: now - hour } })).toBe('100%')
  })

  it('ignores the Used/Remaining preference', () => {
    expect(render('{5h} {5h.passed}', {}, 'remaining')).toBe('55% 60%')
  })

  it('is empty without a reset time, so optional groups drop', () => {
    const noReset = { ...session, resetsAt: null }
    expect(render('{5h}[ of {5h.passed}]', { session: noReset })).toBe('45%')
    expect(render('{5h.total}', { session: noReset })).toBe('5h')
    expect(render('[{7d.passed}][{7d.total}]')).toBe('')
  })

  it('leaves unknown placeholders as literal text', () => {
    expect(render('{5h.passed} {5h.nope} {time_passed_percent}')).toBe(
      '60% {5h.nope} {time_passed_percent}'
    )
  })
})
