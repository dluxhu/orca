import { useState, useSyncExternalStore } from 'react'
import { NativeChatCrewFrame } from '@/components/orchestration-crew/NativeChatCrewPanel'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../../../../shared/agent-session/journal/agent-session-journal-types'

const FOLD_LINES = 16
const FOLD_CHARS = 1600

// shortcut: in memory for the app session only; persist it when people ask for it after a restart.
const openTabs = new Set<string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The header toggle and the panel read one open state per chat tab. */
export function useNativeChatRawPanel(tabId: string): { open: boolean; toggle: () => void } {
  const open = useSyncExternalStore(subscribe, () => openTabs.has(tabId))
  const toggle = (): void => {
    if (open) {
      openTabs.delete(tabId)
    } else {
      openTabs.add(tabId)
    }
    for (const listener of listeners) {
      listener()
    }
  }
  return { open, toggle }
}

/** A user message is its text as Claude receives it: non-empty text blocks joined by one newline. */
function rawEntryText(body: AgentJournalItemBody): string {
  if (body.kind === 'message' && body.role === 'user') {
    return body.blocks
      .filter((block) => block.type !== 'text' || block.text.length > 0)
      .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
      .join('\n')
  }
  return JSON.stringify(body, null, 2)
}

function foldedText(text: string): string | null {
  const lines = text.split('\n')
  if (lines.length <= FOLD_LINES && text.length <= FOLD_CHARS) {
    return null
  }
  return `${lines.slice(0, FOLD_LINES).join('\n').slice(0, FOLD_CHARS)}…`
}

function RawEntry({ item }: { item: AgentJournalRenderItem }): React.JSX.Element {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  const { body } = item
  const sent = body.kind === 'message' && body.role === 'user'
  const text = rawEntryText(body)
  const folded = foldedText(text)
  const time = new Date(item.observedAt)
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-chat-foreground-faint">
        <time dateTime={time.toISOString()}>
          {time.toLocaleTimeString(undefined, { hour12: false })}
        </time>
        <span className={sent ? 'font-medium text-chat-foreground-strong' : undefined}>
          {sent
            ? t('components.native-chat.rawPanel.sent', 'Sent to agent')
            : body.kind === 'message'
              ? `${body.kind} · ${body.role}`
              : body.kind}
        </span>
        {item.shortened ? (
          <span>{t('components.native-chat.rawPanel.shortened', 'shortened by the host')}</span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 text-foreground">
        {folded !== null && !expanded ? folded : text}
      </pre>
      {folded !== null ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-end"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? t('components.native-chat.rawPanel.showLess', 'Show less')
            : t('components.native-chat.rawPanel.showMore', 'Show more')}
        </Button>
      ) : null}
    </li>
  )
}

/** Read only: the journal rows the chat already holds, with no live announcements. */
export function NativeChatRawPanel({
  items
}: {
  items: readonly AgentJournalRenderItem[]
}): React.JSX.Element {
  const t = useTranslate()
  const ordered = items.toSorted(
    (a, b) => a.sequence - b.sequence || (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
  )
  return (
    <section
      aria-label={t('components.native-chat.rawPanel.label', 'Raw messages')}
      className="scrollbar-sleek w-2/5 min-w-64 max-w-2xl shrink-0 overflow-auto border-l border-border p-2 font-mono text-xs"
    >
      <ol className="flex flex-col gap-3">
        {ordered.map((item) => (
          <RawEntry key={item.itemId} item={item} />
        ))}
      </ol>
    </section>
  )
}

/** The chat body: the crew frame, and the raw panel beside it while it is open. */
export function NativeChatRawFrame({
  tabId,
  items,
  ...crew
}: React.ComponentProps<typeof NativeChatCrewFrame> & {
  tabId: string
  items: readonly AgentJournalRenderItem[]
}): React.JSX.Element {
  const { open } = useNativeChatRawPanel(tabId)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <NativeChatCrewFrame {...crew} />
      </div>
      {open ? <NativeChatRawPanel items={items} /> : null}
    </div>
  )
}
