import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatAppProfileDirArgument,
  formatOrcaHomeDirArgument,
  readAppProfileDirArgument,
  readOrcaHomeDirArgument
} from '../../../shared/app-profiles/app-profile-dir-argument'
import { appProfileDir, orcaHomeDisplay, profilePathDisplay } from './app-profile-path-display'

const PROFILE = '/Users/me/Library/Application Support/Orca Profiles/work'

function stubProfileDir(dir: string | null): void {
  vi.stubGlobal('window', { api: { platform: { get: () => ({ appProfileDir: dir }) } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('app profile path display', () => {
  it('reads the profile folder that main puts in the window argv', () => {
    expect(readAppProfileDirArgument(['orca', formatAppProfileDirArgument(PROFILE)])).toBe(PROFILE)
    expect(readAppProfileDirArgument(['orca'])).toBeNull()
  })

  it('reads the Orca data folder, with spaces and "=", from the window argv', () => {
    const home = '/Users/me/Orca Data/a=b/orca-home'
    const argv = ['orca', formatAppProfileDirArgument(PROFILE), formatOrcaHomeDirArgument(home)]
    expect(readOrcaHomeDirArgument(argv)).toBe(home)
    expect(readAppProfileDirArgument(argv)).toBe(PROFILE)
    expect(readOrcaHomeDirArgument(['orca'])).toBeNull()
  })

  it('shows a Windows path in the profile folder from $PROFILE', () => {
    const windowsProfile = 'C:\\Users\\me\\Orca Profiles\\work'
    expect(
      profilePathDisplay(`${windowsProfile}\\orca-home\\keybindings.json`, windowsProfile)
    ).toBe('$PROFILE/orca-home/keybindings.json')
    expect(profilePathDisplay('C:\\Users\\me\\.orca\\keybindings.json', windowsProfile)).toBe(
      'C:\\Users\\me\\.orca\\keybindings.json'
    )
  })

  it('shows a path in the profile folder from $PROFILE', () => {
    stubProfileDir(PROFILE)
    expect(appProfileDir()).toBe(PROFILE)
    expect(profilePathDisplay(`${PROFILE}/orca-home/keybindings.json`)).toBe(
      '$PROFILE/orca-home/keybindings.json'
    )
    expect(orcaHomeDisplay()).toBe('$PROFILE/orca-home')
  })

  it('keeps other paths and the default app text as they are', () => {
    stubProfileDir(PROFILE)
    expect(profilePathDisplay(`${PROFILE}-other/bots/a`)).toBe(`${PROFILE}-other/bots/a`)
    stubProfileDir(null)
    expect(profilePathDisplay('/Users/me/.orca/keybindings.json')).toBe(
      '/Users/me/.orca/keybindings.json'
    )
    expect(orcaHomeDisplay()).toBe('~/.orca')
  })

  it('treats a window without the platform API as the default app', () => {
    vi.stubGlobal('window', {})
    expect(appProfileDir()).toBeNull()
  })
})
