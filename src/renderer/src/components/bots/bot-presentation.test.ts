import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { RuntimeRpcFailure } from '../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { botFolderPreview } from './BotRunsOnPicker'
import {
  botCreateErrorMessage,
  botErrorMessage,
  botFolderDisplay,
  localBotFolderPath
} from './bot-presentation'

// The host's reply when a bot's Hermes is older than chats support (#46746).
const TOO_OLD_REPLY: RuntimeRpcFailure = {
  id: 'desktop-ipc',
  ok: false,
  error: {
    code: 'runtime_error',
    message: 'Your Hermes CLI on this computer is 0.20.5. Chats need 0.23.0 or newer.',
    data: {
      refusal: {
        code: 'structured_agent_session_unsupported',
        details: {
          reason: 'hostUnsupported',
          agentInstallation: {
            agent: 'hermes',
            installedVersion: '0.20.5',
            minimumVersion: '0.23.0'
          }
        }
      }
    }
  },
  _meta: { runtimeId: 'runtime-1' }
}

describe('botErrorMessage', () => {
  it('names the agent release a refused bot chat needs', () => {
    const message = botErrorMessage(new RuntimeRpcCallError(TOO_OLD_REPLY))

    expect(message).toContain('Hermes')
    expect(message).toContain('0.20.5')
    expect(message).toContain('0.23.0')
  })

  it('does not call a paired server this computer', () => {
    // The host's own words call itself this computer; a bot on a paired server is not this one.
    const error = new RuntimeRpcCallError(TOO_OLD_REPLY, {
      kind: 'environment',
      environmentId: 'env-1'
    })

    expect(botErrorMessage(error)).not.toContain('this computer')
  })
})

const PROFILE = '/Users/me/Library/Application Support/Orca Profiles/work'

function stubProfileDir(dir: string | null): void {
  vi.stubGlobal('window', { api: { platform: { get: () => ({ appProfileDir: dir }) } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bot Folder text', () => {
  it('shows a local bot in an app profile from $PROFILE', () => {
    stubProfileDir(PROFILE)
    expect(botFolderDisplay('reviewer', 'local', false)).toBe('$PROFILE/bots/reviewer')
    expect(botFolderPreview('Reviewer', [], 'local', false)).toBe('$PROFILE/bots/reviewer')
  })

  it('keeps ~/.orca for the default app and for a paired server', () => {
    stubProfileDir(null)
    expect(botFolderDisplay('reviewer', 'local', false)).toBe('~/.orca/bots/reviewer')
    expect(botFolderDisplay('reviewer', 'local', true)).toBe('%USERPROFILE%\\.orca\\bots\\reviewer')
    stubProfileDir(PROFILE)
    expect(botFolderDisplay('reviewer', 'runtime:env-1', false)).toBe('~/.orca/bots/reviewer')
  })

  it('opens the real bot folder on this computer, and none in the web client', () => {
    expect(localBotFolderPath('reviewer', false, PROFILE, `${PROFILE}/orca-home`)).toBe(
      `${PROFILE}/bots/reviewer`
    )
    expect(localBotFolderPath('reviewer', false, null, '/Users/me/.orca')).toBe(
      '/Users/me/.orca/bots/reviewer'
    )
    expect(localBotFolderPath('reviewer', true, null, 'C:\\Users\\me\\.orca')).toBe(
      'C:\\Users\\me\\.orca\\bots\\reviewer'
    )
    expect(localBotFolderPath('reviewer', false, null, null)).toBeNull()
  })
})

describe('botErrorMessage on invalid_argument', () => {
  const refusal = (message: string): RuntimeRpcCallError =>
    new RuntimeRpcCallError({
      id: 'desktop-ipc',
      ok: false,
      error: { code: 'invalid_argument', message },
      _meta: { runtimeId: 'runtime-1' }
    })
  const generic = 'Something went wrong. Try again.'

  it('shows a sentence the host worded for people', () => {
    expect(botErrorMessage(refusal("Run this from a bot's chat."))).toBe(
      "Run this from a bot's chat."
    )
  })

  it.each([
    'bot_not_found',
    'Too big: expected string to have <=200 characters',
    'invalid_argument',
    '   ',
    'Refused: tidy_now_busy happened.'
  ])('keeps the generic copy for %j', (message) => {
    expect(botErrorMessage(refusal(message))).toBe(generic)
  })
})

describe('botCreateErrorMessage', () => {
  // An older host's schema refusal of a purpose over its 200 limit.
  const olderHost = new RuntimeRpcCallError({
    id: 'desktop-ipc',
    ok: false,
    error: {
      code: 'invalid_argument',
      message: 'Too big: expected string to have <=200 characters'
    },
    _meta: { runtimeId: 'runtime-1' }
  })

  it('names the older limit when the host refused a long purpose', () => {
    const message = botCreateErrorMessage(olderHost, 'x'.repeat(201), 'build-box')
    expect(message).toContain('up to 200 characters')
    // Names the computer to update, so a paired one isn't read as this Mac.
    expect(message).toContain('update Orca on build-box')
  })

  it('keeps the generic copy when the purpose was within the older limit', () => {
    expect(botCreateErrorMessage(olderHost, 'x'.repeat(200), 'build-box')).toBe(
      'Something went wrong. Try again.'
    )
  })
})
