import { afterEach, describe, expect, it, vi } from 'vitest'
import { botFolderPreview } from './BotRunsOnPicker'
import { botFolderDisplay } from './bot-presentation'

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
})
