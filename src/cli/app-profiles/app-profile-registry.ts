// Writers of profiles.json: docs/fork/profiles-design.md, section 4.
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_PROFILES_REGISTRY,
  type AppProfileRegistry
} from '../../shared/app-profiles/app-profile-paths'
import { RuntimeClientError } from '../runtime/connection/types'

export function writeRegistry(root: string, registry: AppProfileRegistry): void {
  const path = join(root, APP_PROFILES_REGISTRY)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`)
  renameSync(temporary, path)
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Runs body while this process holds the lock file. A lock of a dead process is removed. */
export function withRegistryLock<T>(root: string, body: () => T): T {
  const lock = join(root, `${APP_PROFILES_REGISTRY}.lock`)
  const take = (): number | null => {
    try {
      const fd = openSync(lock, 'wx')
      writeFileSync(fd, String(process.pid))
      return fd
    } catch {
      return null
    }
  }
  let fd = take()
  if (fd === null) {
    let owner = 0
    try {
      owner = Number(readFileSync(lock, 'utf8'))
    } catch {
      // The lock went away; take it below.
    }
    if (!owner || !isProcessAlive(owner)) {
      rmSync(lock, { force: true })
      fd = take()
    }
  }
  if (fd === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Another process changes the profiles now (${lock}). Try again later.`
    )
  }
  try {
    return body()
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}
