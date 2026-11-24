import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const created = vi.hoisted(() => ({ options: [] as unknown[], used: [] as unknown[] }))
vi.mock('./app-profile-icon', async (original) => ({
  ...(await original<object>()),
  appProfileIconParts: (_app: string, source: unknown, used: unknown) => {
    created.used.push(used)
    created.options.push(source)
    const img = (fill: number) => ({
      width: 2,
      height: 2,
      channels: 4,
      data: new Uint8Array(16).fill(fill)
    })
    return { base: img(1), badge: img(2), text: '3' }
  },
  makeAppProfileIcon: (_app: string, _source: unknown, used: unknown) => {
    created.used.push(used)
    return { icns: Buffer.alloc(0), icon: { kind: 'badge', text: '2', style: 'ref-match' } }
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
    write.mockRestore()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
    expect(created.used.at(-1)).toEqual([badge('3')])
  })
})

describe('orca profiles icon-parts', () => {
  it('prints the base icon and the badge as PNGs; the --id profile does not block its badge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-icon-parts-'))
    const badge = (text: string) => ({ kind: 'badge', text, style: 'ref-match' })
    writeFileSync(
      join(root, 'profiles.json'),
      JSON.stringify({
        version: 1,
        defaultAppPath: '/Apps/Orca.app',
        profiles: [
          { id: 'work', name: 'work', icon: badge('2') },
          { id: 'home', name: 'home', icon: badge('3') }
        ]
      })
    )
    vi.stubEnv('ORCA_PROFILES_ROOT', root)
    let out = ''
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
      out += String(text)
      return true
    })
    await runProfilesCommand(['icon-parts', '--id', 'work', '--icon-badge', '4', '--json'])
    write.mockRestore()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
    expect(created.used.at(-1)).toEqual([badge('3')])
    expect(created.options.at(-1)).toEqual({ kind: 'badge', text: '4' })
    const result = JSON.parse(out).result as { base: string; badge: string }
    const png = (base64: string) => Buffer.from(base64, 'base64')
    // PNG files of the two 2 x 2 images.
    expect(png(result.base).subarray(1, 4).toString()).toBe('PNG')
    expect(png(result.base).readUInt32BE(16)).toBe(2)
    expect(result.badge).not.toBe(result.base)
  })

  it('refuses an own icon file, which has no badge', async () => {
    await expect(
      runProfilesCommand(['icon-parts', '--icon-file', '/x/icon.icns', '--json'])
    ).rejects.toThrow('no badge')
  })
})
