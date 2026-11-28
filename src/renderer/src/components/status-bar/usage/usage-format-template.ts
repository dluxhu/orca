import type {
  ProviderRateLimits,
  RateLimitWindow
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { formatResetDuration } from '../../../../../shared/agent-usage/rate-limits/rate-limit-reset-format'
import {
  getDisplayedUsagePercentage,
  type UsagePercentageDisplay
} from '../../../../../shared/agent-usage/display/usage-percentage-display'
import { getProviderDisplayName } from '../../../../../shared/agent-usage/display/usage-provider-windows'
import { formatPlanLabel } from './usage-roster-formatting'

export type UsageFormatValues = Record<string, string>

// Why: `%` lets `{5h.time%}` match; a `{...%}` that is no key still stays verbatim.
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_.%]+)\}/g
// Why: one level of brackets only — nested optional groups aren't worth the parsing cost for a footer string.
// `[[...]]` (a separator) is tried first, so it is never read as a group.
const SEGMENT_RE = /\[\[([^[\]]*)\]\]|\[([^[\]]*)\]/g

/** Replaces known `{key}` placeholders; unknown ones are left verbatim. */
function substitute(text: string, values: UsageFormatValues): string {
  return text.replace(PLACEHOLDER_RE, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match
  )
}

type Segment = { kind: 'text' | 'group' | 'separator'; text: string | null }

/** Renders `{key}` placeholders; `[...]` groups vanish when any known placeholder inside is empty;
 *  a `[[...]]` separator shows only when a group before it and the next group after it both show.
 *  Whitespace is the author's: nothing is collapsed or trimmed, so render it with `whitespace-pre`. */
export function renderUsageFormatTemplate(template: string, values: UsageFormatValues): string {
  const segments: Segment[] = []
  let last = 0
  for (const m of template.matchAll(SEGMENT_RE)) {
    segments.push({ kind: 'text', text: template.slice(last, m.index) })
    last = m.index + m[0].length
    if (m[1] !== undefined) {
      segments.push({ kind: 'separator', text: m[1] })
      continue
    }
    const keys = [...m[2].matchAll(PLACEHOLDER_RE)].map((k) => k[1])
    const missing = keys.some((key) => Object.hasOwn(values, key) && values[key] === '')
    // A bracket pair without placeholders is literal text, not a group.
    segments.push(
      keys.length === 0
        ? { kind: 'text', text: m[0] }
        : { kind: 'group', text: missing ? null : m[2] }
    )
  }
  segments.push({ kind: 'text', text: template.slice(last) })
  // Why "a group before", not "the group before": `[A][[, ]][B][[, ]][C]` without B reads "A, C".
  let shownBefore = false
  return segments
    .map((segment, index) => {
      if (segment.kind === 'separator') {
        const next = segments.slice(index + 1).find((s) => s.kind === 'group')
        return shownBefore && next?.text != null ? substitute(segment.text ?? '', values) : ''
      }
      if (segment.kind === 'group' && segment.text !== null) {
        shownBefore = true
      }
      return segment.text === null ? '' : substitute(segment.text, values)
    })
    .join('')
}

export type UsageFormatValueOptions = {
  display: UsagePercentageDisplay
  now: number
  /** Test hook; production uses the viewer's zone. */
  timeZone?: string
  locale?: string
}

const WINDOW_KEYS: readonly [
  key: string,
  minutes: number | null,
  pick: (p: ProviderRateLimits) => RateLimitWindow | null | undefined
][] = [
  ['5h', 300, (p) => p.session],
  ['7d', 10080, (p) => p.weekly],
  ['fable', null, (p) => p.fableWeekly],
  ['30d', 43200, (p) => p.monthly]
]

/** Window percentage in the user's Used/Remaining preference. */
function percent(window: RateLimitWindow, display: UsagePercentageDisplay): string {
  return `${getDisplayedUsagePercentage(window.usedPercent, display)}%`
}

/** Reset time as a 24h clock string in the viewer's zone. */
function resetClock(resetsAt: number, options: UsageFormatValueOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone
  }).format(resetsAt)
}

/** Every placeholder the footer template can reference, empty string when the provider lacks it. */
export function buildUsageFormatValues(
  p: ProviderRateLimits,
  options: UsageFormatValueOptions
): UsageFormatValues {
  const values: UsageFormatValues = {
    provider: getProviderDisplayName(p.provider),
    plan: formatPlanLabel(p.planType, p.provider) ?? ''
  }
  for (const [key, minutes, pick] of WINDOW_KEYS) {
    const candidate = pick(p)
    const window = minutes === null || candidate?.windowMinutes === minutes ? candidate : null
    values[key] = window ? percent(window, options.display) : ''
    values[`${key}.reset`] =
      window?.resetsAt != null ? formatResetDuration(window.resetsAt - options.now) : ''
    values[`${key}.resetAt`] = window?.resetsAt != null ? resetClock(window.resetsAt, options) : ''
    const windowMs = window && window.windowMinutes > 0 ? window.windowMinutes * 60_000 : null
    // Time passed in Used mode, time left in Remaining mode, rounded like the usage percentage.
    values[`${key}.time%`] =
      windowMs !== null && window?.resetsAt != null
        ? `${getDisplayedUsagePercentage(100 - ((window.resetsAt - options.now) / windowMs) * 100, options.display)}%`
        : ''
  }
  values.buckets = (p.buckets ?? [])
    .map((bucket) => `${bucket.name} ${percent(bucket, options.display)}`)
    .join(' · ')
  return values
}
