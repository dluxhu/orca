import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ appPath: '', packaged: true }))

vi.mock('../../shared/app-lifecycle/app-environment', () => ({
  hasAppEnvironment: () => true,
  getAppEnvironment: () => ({ getAppPath: () => h.appPath, isPackaged: () => h.packaged })
}))

import { currentWorkerEntryLayout, resolveWorkerThreadEntryPath } from './worker-thread-entry-path'

const ownResources = process.resourcesPath
afterEach(() => {
  Object.defineProperty(process, 'resourcesPath', { value: ownResources, configurable: true })
})

it("takes a profile app's workers from the default app's app.asar, which its loader runs", () => {
  Object.defineProperty(process, 'resourcesPath', {
    value: '/Apps/Work.app/Contents/Resources',
    configurable: true
  })
  h.appPath = '/Applications/Orca.app/Contents/Resources/app.asar'
  expect(resolveWorkerThreadEntryPath(currentWorkerEntryLayout('/x/out/main'), 'w.js')).toBe(
    '/Applications/Orca.app/Contents/Resources/app.asar/out/main/w.js'
  )
})

it('keeps process.resourcesPath when the app path is no app.asar (orcad, dev)', () => {
  Object.defineProperty(process, 'resourcesPath', {
    value: '/Applications/Orca.app/Contents/Resources',
    configurable: true
  })
  h.appPath = '/opt/orcad'
  expect(currentWorkerEntryLayout('/x/out/main').resourcesPath).toBe(
    '/Applications/Orca.app/Contents/Resources'
  )
})
