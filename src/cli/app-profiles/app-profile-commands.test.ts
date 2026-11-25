import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => ({
  options: [] as unknown[],
  used: [] as unknown[],
  setIcon: [] as unknown[]
}))
vi.mock('./app-profile-icon', async (original) => ({
  ...(await original<object>()),
  makeAppProfileIcon: (_app: string, _source: unknown, used: unknown) => {
    created.used.push(used)
    return {
      icns: Buffer.alloc(0),
      icon: { kind: 'badge', text: '2', style: 'ref-match' },
      menuBarPng: Buffer.from('template')
    }
  }
}))
vi.mock('./app-profile-set-icon', () => ({
  setAppProfileIcon: async (...args: unknown[]) => {
    created.setIcon.push(args)
    return { id: 'work' }
  }
}))
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

  it('passes --icon-color with the badge', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runProfilesCommand(['create', 'Work', '--icon-badge', 'Q', '--icon-color', '#2563EB'])
    write.mockRestore()
    expect(created.options.at(-1)).toMatchObject({
      icon: { kind: 'badge', text: 'Q', color: '#2563eb' }
    })
  })
})

describe.skipIf(process.platform !== 'darwin')('orca profiles icon-preview', () => {
  it('treats the badge of the --id profile as free', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-icon-preview-'))
    const badge = (text: string) => ({ kind: 'badge', text, style: 'ref-match' })
    const profile = (id: string, text: string) => ({ id, name: id, icon: badge(text) })
    writeFileSync(
      join(root, 'profiles.json'),
      JSON.stringify({
        version: 1,
        defaultAppPath: '/Apps/Orca.app',
        profiles: [profile('work', '2'), profile('home', '3')]
      })
    )
    vi.stubEnv('ORCA_PROFILES_ROOT', root)
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runProfilesCommand(['icon-preview', '--id', 'work', '--json'])
    const reply = JSON.parse(String(write.mock.calls.at(-1)?.[0]))
    write.mockRestore()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
    expect(created.used.at(-1)).toEqual([badge('3')])
    // The menu-bar template comes with the icon, for the Edit form's preview.
    expect(Buffer.from(reply.result.menuBarPng, 'base64').toString()).toBe('template')
  })
})

describe.skipIf(process.platform !== 'darwin')('orca profiles set-icon', () => {
  it('passes --if-missing to setAppProfileIcon as ifMissing', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runProfilesCommand(['set-icon', 'work', '--if-missing', '--json'])
    await runProfilesCommand(['set-icon', 'work', '--icon-badge', 'Q', '--json'])
    write.mockRestore()
    expect(created.setIcon).toEqual([
      ['work', { kind: 'badge' }, { ifMissing: true }],
      ['work', { kind: 'badge', text: 'Q', style: undefined }, { ifMissing: false }]
    ])
  })
})
