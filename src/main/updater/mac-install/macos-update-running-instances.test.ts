import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pidsByBundle: new Map<string, number[]>(),
  queried: [] as string[]
}))

vi.mock('@orca/process-host', () => ({
  runProcess: async ({ args }: { args: string[] }) => {
    const bundle = args.at(-1) as string
    h.queried.push(bundle)
    return {
      code: 0,
      timedOut: false,
      outputTruncated: false,
      stdout: JSON.stringify(h.pidsByBundle.get(bundle) ?? [])
    }
  }
}))

import { getMacUpdateRunningInstances } from './macos-update-running-instances'

let dir: string
let app: string
let managerApp: string
const executable = (): string => join(app, 'Contents', 'MacOS', 'Orca')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-update-instances-unit-'))
  app = join(dir, 'Orca.app')
  managerApp = join(app, 'Contents', 'Applications', 'Orca Profile Manager.app')
  h.pidsByBundle.clear()
  h.queried.length = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('getMacUpdateRunningInstances', () => {
  it('counts an open Profile Manager app as a running instance of the app', async () => {
    mkdirSync(managerApp, { recursive: true })
    h.pidsByBundle.set(app, [100, 101])
    h.pidsByBundle.set(managerApp, [200])
    expect(await getMacUpdateRunningInstances(executable(), 100)).toEqual([101, 200])
    expect(h.queried).toEqual([app, managerApp])
  })

  it('asks only for the app when it has no Profile Manager app', async () => {
    h.pidsByBundle.set(app, [100, 101])
    expect(await getMacUpdateRunningInstances(executable(), 100)).toEqual([101])
    expect(h.queried).toEqual([app])
  })
})
