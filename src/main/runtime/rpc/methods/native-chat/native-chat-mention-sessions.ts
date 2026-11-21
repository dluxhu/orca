import { defineMethod } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import { callRuntimeEnvironment } from '../../../../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { isGatedOffWslHost } from '../../../../wsl/host-lifecycle/wsl-host-gate'
import {
  listNativeChatMentionSessionRows,
  NATIVE_CHAT_MENTION_SESSIONS_METHOD,
  NativeChatMentionSessionsParams,
  type NativeChatMentionSessionRow,
  type NativeChatMentionSessionsResult
} from '../../../../../shared/native-chat/native-chat-mention-sessions'

/** A host that does not answer in this time is left out of the list. */
export const MENTION_HOST_TIMEOUT_MS = 3_000

const TERMINAL_LIST_PARAMS = { includeVisualLayouts: false, includePreview: false }

export type NativeChatMentionHost = {
  /** The saved environment name; absent for the host that runs this method. */
  environment?: string
  ps(signal: AbortSignal): Promise<unknown>
  terminals(signal: AbortSignal): Promise<unknown>
}

/** Reads every host in parallel. A failed, late or malformed list leaves its rows out, never the other hosts. */
export async function collectNativeChatMentionSessions(
  hosts: readonly NativeChatMentionHost[],
  self: { sessionId?: string; ptyId?: string | null },
  timeoutMs = MENTION_HOST_TIMEOUT_MS
): Promise<NativeChatMentionSessionsResult> {
  const perHost = await Promise.all(
    hosts.map(async (host): Promise<NativeChatMentionSessionRow[]> => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve(null)
        }, timeoutMs)
      })
      const settle = <T>(read: Promise<T>): Promise<T | null> =>
        Promise.race([read.catch(() => null), deadline])
      try {
        const [ps, terminals] = await Promise.all([
          settle(host.ps(controller.signal)),
          settle(host.terminals(controller.signal))
        ])
        const rows = listNativeChatMentionSessionRows(
          ps,
          terminals,
          host.environment === undefined ? self : {}
        )
        return host.environment === undefined
          ? rows
          : rows.map((row) => ({ ...row, environment: host.environment }))
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return { sessions: perHost.flat() }
}

async function unwrap(response: Promise<{ ok: boolean; result?: unknown }>): Promise<unknown> {
  const settled = await response
  if (!settled.ok) {
    throw new Error('runtime call failed')
  }
  return settled.result
}

export const NATIVE_CHAT_MENTION_SESSION_METHODS = [
  defineMethod({
    name: NATIVE_CHAT_MENTION_SESSIONS_METHOD,
    permission: 'workspace',
    params: NativeChatMentionSessionsParams,
    handler: async (params, { runtime }) => {
      const userDataPath = getAppEnvironment().getPath('userData')
      const call =
        (environmentId: string, method: string, methodParams: unknown) => (signal: AbortSignal) =>
          unwrap(
            callRuntimeEnvironment(
              userDataPath,
              environmentId,
              method,
              methodParams,
              MENTION_HOST_TIMEOUT_MS,
              undefined,
              undefined,
              // A mention list never starts a stopped WSL host.
              { signal, preparation: { wslStart: 'never' } }
            )
          )
      const own: NativeChatMentionHost = {
        ps: () => runtime.getWorktreePs(),
        terminals: () =>
          runtime.listTerminals(undefined, undefined, { includeVisualLayouts: false })
      }
      const saved = (await listEnvironments(userDataPath))
        .filter((environment) => !isGatedOffWslHost(environment))
        .map((environment): NativeChatMentionHost => ({
          environment: environment.name,
          ps: call(environment.id, 'worktree.ps', {}),
          terminals: call(environment.id, 'terminal.list', TERMINAL_LIST_PARAMS)
        }))
      return collectNativeChatMentionSessions([own, ...saved], params)
    }
  })
]
