// A start check of the Profile Manager app for the release build. With ORCA_PROFILE_MANAGER_SMOKE
// set, the app shows no window, waits until the page shows its heading, prints one result line and
// exits: 0 when the page renders, 1 when it does not.
import type { BrowserWindow } from 'electron'

export const PROFILE_MANAGER_SMOKE_ENV = 'ORCA_PROFILE_MANAGER_SMOKE'
const PAGE = /\/out\/renderer\/profile-manager\.html(#.*)?$/

/** Null when the page renders its heading in time, else the first problem. */
export async function profileManagerSmoke(
  window: BrowserWindow,
  timeoutMs = 20_000,
  pollMs = 250
): Promise<string | null> {
  const problems: string[] = []
  const contents = window.webContents
  // Electron gives an event object; older versions give the level and message as arguments.
  contents.on('console-message', (event: unknown, level?: unknown, message?: unknown) => {
    const details = event as { level?: unknown; message?: unknown }
    if ((details.level ?? level) === 'error' || (details.level ?? level) === 3) {
      problems.push(`console error: ${String(details.message ?? message)}`)
    }
  })
  contents.on('render-process-gone', (_event, details) =>
    problems.push(`renderer gone: ${details.reason}`)
  )
  contents.on('did-fail-load', (_event, code, description) =>
    problems.push(`load failed: ${code} ${description}`)
  )
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (problems.length > 0) {
      return problems[0]
    }
    const rendered = await contents
      .executeJavaScript("Boolean(document.querySelector('h1'))", true)
      .catch(() => false)
    // An error can arrive while the query runs.
    if (problems.length > 0) {
      return problems[0]
    }
    // The page must be the packaged Profile Manager page, not some other document.
    if (rendered === true && PAGE.test(contents.getURL())) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return problems[0] ?? `no heading after ${timeoutMs} ms (${contents.getURL() || 'no page'})`
}

/**
 * Runs the check once and calls `done` once with the result line and the exit code. A hard timer
 * and a catch make sure that `done` runs, also when the window breaks or never answers.
 */
export function runProfileManagerSmoke(
  open: () => BrowserWindow,
  done: (line: string, code: number) => void,
  hardMs = 25_000
): void {
  let finished = false
  const finish = (result: string, code: number): void => {
    if (!finished) {
      finished = true
      clearTimeout(timer)
      done(`profile-manager-smoke: ${result}`, code)
    }
  }
  const timer = setTimeout(() => finish(`fail no result after ${hardMs} ms`, 1), hardMs)
  void Promise.resolve()
    .then(async () => {
      const window = open()
      const problem = await profileManagerSmoke(window)
      finish(problem ? `fail ${problem}` : `ok ${window.webContents.getURL()}`, problem ? 1 : 0)
    })
    .catch((error: unknown) =>
      finish(`fail ${error instanceof Error ? error.message : String(error)}`, 1)
    )
}
