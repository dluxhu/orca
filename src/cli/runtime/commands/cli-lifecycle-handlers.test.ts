import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ userDataPath: '', serveOrcaApp: vi.fn(async () => 0) }))

vi.mock('../launch', () => ({ serveOrcaApp: h.serveOrcaApp }))
vi.mock('../app-launch/packaged-cli-interpreter', () => ({ reenterPackagedElectron: () => {} }))
vi.mock('../profile/launch-user-data-path', () => ({
  resolveLaunchUserDataPath: () => h.userDataPath
}))

import { CORE_HANDLERS } from './cli-lifecycle-handlers'
import type { HandlerContext } from '../../dispatch/dispatch'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-serve-port-'))
  h.userDataPath = join(dir, 'orca')
  mkdirSync(h.userDataPath)
  writeFileSync(
    join(dir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      defaultAppPath: '/Apps/Orca.app',
      defaultPort: 6769,
      profiles: []
    })
  )
  vi.stubEnv('ORCA_PROFILES_ROOT', dir)
  h.serveOrcaApp.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const serve = (flags: [string, string | boolean][]): Promise<void> =>
  CORE_HANDLERS.serve({ flags: new Map(flags), json: false } as unknown as HandlerContext)

describe('orca serve', () => {
  it('uses the saved port without --port, and --port before it', async () => {
    await serve([])
    expect(h.serveOrcaApp).toHaveBeenLastCalledWith(expect.objectContaining({ port: '6769' }))
    await serve([['port', '7000']])
    expect(h.serveOrcaApp).toHaveBeenLastCalledWith(expect.objectContaining({ port: '7000' }))
  })
})
