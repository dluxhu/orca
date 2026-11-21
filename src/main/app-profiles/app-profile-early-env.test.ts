import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_PROFILE_AGENT_HOME_VARIABLES } from '../../shared/app-profiles/app-profile-homes'

const { profile } = vi.hoisted(() => ({
  profile: { current: null as null | { userDataPath: string } }
}))
vi.mock('./app-profile', () => ({ getAppProfile: () => profile.current }))

// Every variable the module may set is stubbed, so none leaks into other tests.
beforeEach(() => {
  vi.stubEnv('HOME', '/tmp/orca-early-env-home')
  for (const key of [
    'ORCA_HOME_DIR',
    'ORCA_APP_PROFILE_ENV_KEYS',
    ...Object.keys(APP_PROFILE_AGENT_HOME_VARIABLES)
  ]) {
    vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('the first main process module', () => {
  it("applies the profile's folders before any other module reads them", async () => {
    profile.current = { userDataPath: '/profiles/work' }
    await import('./app-profile-early-env')
    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/profiles/work/orca-home/agents/claude')
  })

  it("drops folders inherited from a profile's terminal in the default app", async () => {
    vi.stubEnv('ORCA_APP_PROFILE_ENV_KEYS', 'CLAUDE_CONFIG_DIR')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/profiles/work/orca-home/agents/claude')
    profile.current = null
    await import('./app-profile-early-env')
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined()
  })
})
