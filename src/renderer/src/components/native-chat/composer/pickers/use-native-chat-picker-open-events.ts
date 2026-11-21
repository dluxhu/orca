import { useEffect, useRef } from 'react'
import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/composer/native-chat-composer-autocomplete'
import { emitNativeChatPickerOpened } from '@/components/native-chat/telemetry/native-chat-telemetry'

/** Reports each opening of the `/` menu once, and tells `onPickerDemand` while the menu is open. */
export function useNativeChatPickerOpenEvents(
  {
    agent,
    onPickerOpened,
    onPickerDemand
  }: {
    agent: AgentType
    onPickerOpened?: () => void
    onPickerDemand?: (open: boolean) => void
  },
  autocomplete: ComposerAutocomplete,
  dismissalContext: string
): void {
  const lastOpenKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (autocomplete.mode !== 'slash') {
      lastOpenKeyRef.current = null
      return
    }
    const openKey = `${dismissalContext}:${autocomplete.triggerKey}`
    if (lastOpenKeyRef.current !== openKey) {
      lastOpenKeyRef.current = openKey
      emitNativeChatPickerOpened({ agent, prefix: autocomplete.prefix })
      onPickerOpened?.()
    }
  }, [agent, autocomplete, dismissalContext, onPickerOpened])

  const menuOpen = autocomplete.mode === 'slash'
  useEffect(() => {
    onPickerDemand?.(menuOpen)
    return () => onPickerDemand?.(false)
  }, [dismissalContext, menuOpen, onPickerDemand])
}
