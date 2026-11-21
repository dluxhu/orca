// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatNoticeRow } from './NativeChatNoticeRow'
import { i18n } from '@/i18n/i18n'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

const row = (text: string) => (
  <NativeChatNoticeRow agentName="Claude" block={{ type: 'text', text, presentation: 'compaction' }} />
)

it('names an automatic compaction divider with its trigger', async () => {
  render(row('Context compacted automatically'))
  expect(screen.getByRole('separator', { name: 'Context compacted automatically' })).toBeVisible()

  cleanup()
  await i18n.changeLanguage('de')
  render(row('Context compacted automatically'))
  expect(screen.getByRole('separator', { name: 'Kontext automatisch komprimiert' })).toBeVisible()
})

it('keeps the plain name for any other compaction', () => {
  render(row('Context compacted'))
  expect(screen.getByRole('separator', { name: 'Context compacted' })).toBeVisible()
})
