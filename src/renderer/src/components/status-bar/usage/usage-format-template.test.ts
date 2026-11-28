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
  it('fills {5h.time%}', () => {
    expect(render('{5h.time%}')).toBe('60%')
  })

  it('leaves the removed {5h.total} as literal text', () => {
    expect(render('{5h.total} {7d.total}')).toBe('{5h.total} {7d.total}')
  })

  it('renders a usage-of-time-passed template', () => {
    expect(render('{5h} of {5h.time%} {5h.reset}')).toBe('45% of 60% 2h')
  })

  it('follows the Used/Remaining preference like the usage percentage', () => {
    expect(render('{5h} of {5h.time%} {5h.reset}', {}, 'remaining')).toBe('55% of 40% 2h')
  })

  it('works for the weekly and Fable windows', () => {
    const weekly = { ...session, windowMinutes: 10080, resetsAt: now + 42 * hour }
    expect(render('{7d.time%}', { weekly })).toBe('75%')
    expect(render('{fable.time%}', { fableWeekly: weekly })).toBe('75%')
  })

  it('rounds like the usage percentage and clamps to 0..100', () => {
    // 3h 1.5m of 5h = 60.5% rounds up, as usage does; Remaining complements the rounded value.
    const late = { session: { ...session, resetsAt: now + 2 * hour - 90_000 } }
    expect(render('{5h.time%}', late)).toBe('61%')
    expect(render('{5h.time%}', late, 'remaining')).toBe('39%')
    expect(render('{5h.time%}', { session: { ...session, resetsAt: now + 9 * hour } })).toBe('0%')
    expect(render('{5h.time%}', { session: { ...session, resetsAt: now - hour } })).toBe('100%')
  })

  it('is empty without a reset time, so optional groups drop', () => {
    const noReset = { ...session, resetsAt: null }
    expect(render('{5h}[ of {5h.time%}]', { session: noReset })).toBe('45%')
    expect(render('[{7d.time%}][{7d}]')).toBe('')
  })

  it('leaves unknown placeholders as literal text, also with a %', () => {
    expect(render('{5h.time%} {5h.nope} {5h.passed} {50%} {%}')).toBe(
      '60% {5h.nope} {5h.passed} {50%} {%}'
    )
  })

  it('renders an existing template as before', () => {
    expect(render('{provider}[ | 5h: {5h} ({5h.reset})][ | 7d: {7d}] {5h.resetAt}')).toBe(
      'Claude | 5h: 45% (2h) 14:00'
    )
    expect(render('{5h} is 100% [{7d} 7d]')).toBe('45% is 100% ')
  })
})

describe('[[ ]] separators', () => {
  const weekly = { ...session, usedPercent: 20, windowMinutes: 10080, resetsAt: now + 42 * hour }
  const both = { weekly }

  it('shows between two shown groups', () => {
    expect(render('[5h {5h}][[ · ]][wk {7d}]', both)).toBe('5h 45% · wk 20%')
  })

  it('drops when the left, the right or both groups drop', () => {
    expect(render('[5h {5h}][[ · ]][wk {7d}]', { session: null, weekly })).toBe('wk 20%')
    expect(render('[5h {5h}][[ · ]][wk {7d}]')).toBe('5h 45%')
    expect(render('[5h {5h}][[ · ]][wk {7d}]', { session: null })).toBe('')
  })

  it('drops at the start or end, with no group on one side', () => {
    expect(render('[[ · ]][{5h}]')).toBe('45%')
    expect(render('[{5h}][[ · ]]')).toBe('45%')
    expect(render('[[ · ]]')).toBe('')
  })

  it('joins the shown groups of a chain with one separator each', () => {
    const t = '[{5h}][[ · ]][{7d}][[ | ]][{fable}]'
    expect(render(t, { weekly, fableWeekly: weekly })).toBe('45% · 20% | 20%')
    // The middle group drops: one separator, the one before the next shown group.
    expect(render(t, { fableWeekly: weekly })).toBe('45% | 20%')
    expect(render(t, { session: null, fableWeekly: weekly })).toBe('20%')
    expect(render(t, both)).toBe('45% · 20%')
  })

  it('looks past plain text to the groups, and fills placeholders inside it', () => {
    expect(render('{provider} [{5h}] x [[ / {plan} ]] y [{7d}]', both)).toBe(
      'Claude 45% x  /   y 20%'
    )
  })

  it('needs a group, not literal brackets, on each side', () => {
    expect(render('[note][[ · ]][{5h}]')).toBe('[note]45%')
  })

  it('leaves unmatched or nested brackets as before', () => {
    expect(render('[[{5h}]')).toBe('[45%')
    expect(render('[{5h}]]')).toBe('45%]')
    expect(render('[[ [{5h}] ]]')).toBe('[[ 45% ]]')
  })
})
