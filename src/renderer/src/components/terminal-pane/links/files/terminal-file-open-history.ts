import { useAppStore } from '@/store/index'

/** Runs `activate`. When `recordsHistory` is false, the caller records the history entries of the
 *  open, so the activation records no visit. */
export function activateRecordingHistory(
  recordsHistory: false | undefined,
  activate: () => void
): void {
  if (recordsHistory !== false) {
    activate()
    return
  }
  const navigating = useAppStore.getState().isNavigatingHistory
  useAppStore.setState({ isNavigatingHistory: true })
  try {
    activate()
  } finally {
    useAppStore.setState({ isNavigatingHistory: navigating })
  }
}
