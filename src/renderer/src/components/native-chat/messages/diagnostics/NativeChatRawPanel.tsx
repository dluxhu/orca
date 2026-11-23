import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { Braces } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { NativeChatDockTranscript } from '../../pane/dock/NativeChatDock'
import {
  geometryOf,
  isNearBottom,
  NATIVE_CHAT_FOLLOW_REARM_PX
} from '../../viewport/scroll/native-chat-autoscroll'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../../../../shared/agent-session/journal/agent-session-journal-types'

const FOLD_LINES = 16
const FOLD_CHARS = 1600

// shortcut: in memory for the app session only; persist it when people ask for it after a restart.
const openTabs = new Set<string>()
// The reply that a {} link asked the tab's panel to mark. A new object for each click.
const focusedTabs = new Map<string, { messageId: string }>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** The header toggle and the panel read one open state per chat tab. */
export function useNativeChatRawPanel(tabId: string): { open: boolean; toggle: () => void } {
  const open = useSyncExternalStore(subscribe, () => openTabs.has(tabId))
  const toggle = (): void => {
    if (open) {
      openTabs.delete(tabId)
      focusedTabs.delete(tabId)
    } else {
      openTabs.add(tabId)
    }
    notify()
  }
  return { open, toggle }
}

/** A reply's raw entries: the rows of its turn except the sent messages. Outside a turn, its own row. */
function replyEntries(
  items: readonly AgentJournalRenderItem[],
  messageId: string
): ReadonlySet<string> {
  const scope = items.find((item) => item.itemId === messageId)?.turnScope
  if (scope?.kind !== 'turn') {
    return new Set([messageId])
  }
  return new Set(
    items.flatMap((item) =>
      item.itemId === scope.turnItemId ||
      (item.turnScope?.kind === 'turn' &&
        item.turnScope.turnItemId === scope.turnItemId &&
        !(item.body.kind === 'message' && item.body.role === 'user'))
        ? [item.itemId]
        : []
    )
  )
}

type RawLinkSource = { has: (messageId: string) => boolean; show: (messageId: string) => void }
const NativeChatRawLinkContext = createContext<RawLinkSource | undefined>(undefined)

/** The {} action under a reply. It shows only for a reply that has raw entries. */
export function NativeChatRawLink({ messageId }: { messageId: string }): React.JSX.Element | null {
  const t = useTranslate()
  const source = useContext(NativeChatRawLinkContext)
  if (!source?.has(messageId)) {
    return null
  }
  const label = t('components.native-chat.rawPanel.showReply', 'Show raw messages for this reply')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={label}
          onClick={() => source.show(messageId)}
        >
          <Braces className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

type SentBlocks = Extract<AgentJournalItemBody, { kind: 'message' }>['blocks']

/** Claude's dispatch: images go first, then the non-empty text blocks joined by one newline. */
function sentParts(blocks: SentBlocks): { images: { key: string; name: string }[]; text: string } {
  const images: { key: string; name: string }[] = []
  const texts: string[] = []
  // The record never reorders, so a block's place is its stable key.
  for (const [place, block] of blocks.entries()) {
    if (block.type === 'image-ref') {
      images.push({ key: `block-${place}`, name: block.path ?? block.url ?? block.alt ?? '' })
    } else if (block.type === 'text' && block.text.length > 0) {
      texts.push(block.text)
    }
  }
  return { images, text: texts.join('\n') }
}

function foldedText(text: string): string | null {
  const lines = text.split('\n')
  if (lines.length <= FOLD_LINES && text.length <= FOLD_CHARS) {
    return null
  }
  return `${lines.slice(0, FOLD_LINES).join('\n').slice(0, FOLD_CHARS)}…`
}

const RawEntry = memo(
  function RawEntry({
    item,
    marked
  }: {
    item: AgentJournalRenderItem
    marked: boolean
  }): React.JSX.Element {
    const t = useTranslate()
    const intlLocale = useIntlLocale()
    const [expanded, setExpanded] = useState(false)
    const { body } = item
    const sent = body.kind === 'message' && body.role === 'user'
    const parts = sent ? sentParts(body.blocks) : null
    const text = parts ? parts.text : JSON.stringify(body, null, 2)
    const folded = foldedText(text)
    const time = new Date(item.observedAt)
    return (
      <li
        data-current={marked || undefined}
        aria-current={marked || undefined}
        className={cn('flex flex-col gap-1', marked && 'rounded-md bg-accent')}
      >
        <div className="flex items-center gap-2 text-chat-foreground-faint">
          <time dateTime={time.toISOString()}>
            {time.toLocaleTimeString(intlLocale, { hour12: false })}
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
        {parts && parts.images.length > 0 ? (
          <ul className="text-chat-foreground-faint">
            {parts.images.map((image) => (
              <li key={image.key}>
                {t('components.native-chat.rawPanel.image', 'Image:')} {image.name}
              </li>
            ))}
          </ul>
        ) : null}
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
  },
  // Journal rows change only with a new revision.
  (before, after) =>
    before.item.itemId === after.item.itemId &&
    before.item.revision === after.item.revision &&
    before.marked === after.marked
)

/** Read only: the journal rows the chat already holds, with no live announcements. */
export function NativeChatRawPanel({
  items,
  focus
}: {
  items: readonly AgentJournalRenderItem[]
  /** The reply to mark and scroll to. */
  focus?: { messageId: string }
}): React.JSX.Element {
  const t = useTranslate()
  const ordered = items.toSorted(
    (a, b) => a.sequence - b.sequence || (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
  )
  const scrollRef = useRef<HTMLElement>(null)
  // Open at the newest entry, and follow new ones until the reader scrolls up.
  const followingRef = useRef(true)
  useLayoutEffect(() => {
    const panel = scrollRef.current
    if (panel && followingRef.current) {
      panel.scrollTop = panel.scrollHeight
    }
  }, [items])
  const marked = useMemo(
    () => (focus ? replyEntries(items, focus.messageId) : new Set<string>()),
    [items, focus]
  )
  // A marked reply stops the follow. A scroll back to the end starts it again.
  // The panel takes focus, so a screen reader names it and Space pages it.
  useLayoutEffect(() => {
    const panel = scrollRef.current
    if (focus && panel) {
      followingRef.current = false
      panel.focus({ preventScroll: true })
      panel.querySelector('[data-current]')?.scrollIntoView({ block: 'start' })
    }
  }, [focus])
  return (
    <section
      ref={scrollRef}
      onScroll={(event) => {
        followingRef.current = isNearBottom(
          geometryOf(event.currentTarget),
          NATIVE_CHAT_FOLLOW_REARM_PX
        )
      }}
      data-native-chat-raw-panel
      tabIndex={0}
      aria-label={t('components.native-chat.rawPanel.label', 'Raw messages')}
      className="scrollbar-sleek w-2/5 min-w-64 max-w-2xl shrink-0 overflow-auto border-l border-border p-2 font-mono text-xs"
    >
      <ol className="flex flex-col gap-3">
        {ordered.map((item) => (
          <RawEntry key={item.itemId} item={item} marked={marked.has(item.itemId)} />
        ))}
      </ol>
    </section>
  )
}

/** The chat body, and the raw panel beside it while it is open. Its replies get {} links. */
export function NativeChatRawFrame({
  tabId,
  items,
  children
}: {
  tabId: string
  items: readonly AgentJournalRenderItem[]
  children: React.ReactNode
}): React.JSX.Element {
  const { open } = useNativeChatRawPanel(tabId)
  const focus = useSyncExternalStore(subscribe, () => focusedTabs.get(tabId))
  // A journal update must not draw the links again. They read the newest rows from this ref.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const links = useMemo(
    (): RawLinkSource => ({
      has: (messageId) => itemsRef.current.some((item) => item.itemId === messageId),
      show: (messageId) => {
        openTabs.add(tabId)
        focusedTabs.set(tabId, { messageId })
        notify()
      }
    }),
    [tabId]
  )
  return (
    <div className="flex min-h-0 flex-1">
      <NativeChatRawLinkContext.Provider value={links}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </NativeChatRawLinkContext.Provider>
      {open ? <NativeChatRawPanel items={items} focus={focus} /> : null}
    </div>
  )
}

/** The chat's dock transcript with the raw panel beside it. */
export function NativeChatRawDockTranscript(props: {
  tabId: string
  items: readonly AgentJournalRenderItem[]
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <NativeChatDockTranscript>
      <NativeChatRawFrame {...props} />
    </NativeChatDockTranscript>
  )
}
