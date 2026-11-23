import { describe, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => ({ options: [] as unknown[] }))
vi.mock('./app-profile-create', async (original) => ({
  ...(await original<object>()),
  createAppProfile: (options: unknown) => {
    created.options.push(options)
    return { id: 'work' }
  },
  defaultAppOf: (path: string) => path
}))
vi.mock('../runtime/serve/updates/mac-app-update-bundle', () => ({
  getMacAppBundlePath: () => '/Apps/Orca.app'
}))

import { profileManagerOpenArgs, runProfilesCommand } from './app-profile-commands'

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

describe.skipIf(process.platform !== 'darwin')('orca profiles create', () => {
  it('passes the --icon flags to the create', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runProfilesCommand([
      'create',
      'Orca - Work',
      '--icon-image',
      '/x/logo.svg',
      '--icon-style',
      'ref-match-bigger',
      '--json'
    ])
    write.mockRestore()
    expect(created.options.at(-1)).toMatchObject({
      name: 'Orca - Work',
      defaultAppPath: '/Apps/Orca.app',
      icon: { kind: 'image', path: '/x/logo.svg', style: 'ref-match-bigger' }
    })
  })
})
