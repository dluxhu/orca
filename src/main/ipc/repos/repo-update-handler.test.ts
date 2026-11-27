import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { Repo } from '../../../shared/repository/repo-types'
import { registerRepoUpdateHandler } from './repo-update-handler'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))
vi.mock('./repos-changed-notification', () => ({ notifyReposChanged: vi.fn() }))

const REPO: Repo = {
  id: 'repo-1',
  path: '/repo-1',
  displayName: 'r',
  badgeColor: '#000',
  addedAt: 0
}

async function savedUpdates(updates: Record<string, unknown>): Promise<unknown> {
  const updateRepo = vi.fn((_target: unknown, _updates: unknown) => REPO)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these two store methods here.
  const store = { getRepo: () => REPO, updateRepo } as unknown as Store
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the notification is mocked.
  registerRepoUpdateHandler({} as BrowserWindow, store)
  await handlers.get('repos:update')?.(undefined, { repoId: REPO.id, updates })
  return updateRepo.mock.calls[0]?.[1]
}

describe('repos:update linkBareReferencesInChat', () => {
  it('saves a boolean', async () => {
    expect(await savedUpdates({ linkBareReferencesInChat: false })).toEqual({
      linkBareReferencesInChat: false
    })
  })

  it('drops a value that is not a boolean and keeps the other fields', async () => {
    expect(await savedUpdates({ linkBareReferencesInChat: 'off', displayName: 'n' })).toEqual({
      displayName: 'n'
    })
  })
})
