import { describe, expect, it } from 'vitest'
import { profileManagerOpenArgs } from './app-profile-commands'

const managerApp = '/Apps/Orca.app/Contents/Applications/Orca Profile Manager.app'

describe('profileManagerOpenArgs', () => {
  it('opens the Profile Manager app inside the default app, without -n', () => {
    // Without -n, `open` brings a running Profile Manager to the front: one instance.
    expect(profileManagerOpenArgs('/Apps/Orca.app', (path) => path === managerApp)).toEqual([
      '-a',
      managerApp
    ])
  })

  it('asks a default app without the Manager app for its own window', () => {
    expect(profileManagerOpenArgs('/Apps/Orca.app', () => false)).toEqual([
      '-a',
      '/Apps/Orca.app',
      '-n',
      '--args',
      '--orca-profile-manager'
    ])
  })
})
