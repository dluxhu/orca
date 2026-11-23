// Writers of profiles.json: docs/fork/profiles-design.md, section 4.
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, join, sep } from 'node:path'
import {
  APP_PROFILES_REGISTRY,
  locateAppProfileApp,
  readAppProfileRegistry,
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

function acquireRegistryLock(root: string): number {
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
  return fd
}

function releaseRegistryLock(root: string, fd: number): void {
  closeSync(fd)
  rmSync(join(root, `${APP_PROFILES_REGISTRY}.lock`), { force: true })
}

/** Runs body while this process holds the lock file. A lock of a dead process is removed. */
export function withRegistryLock<T>(root: string, body: () => T): T {
  const fd = acquireRegistryLock(root)
  try {
    return body()
  } finally {
    releaseRegistryLock(root, fd)
  }
}

/** withRegistryLock for a body that awaits, for example a state check before a change. */
export async function withRegistryLockAsync<T>(root: string, body: () => Promise<T>): Promise<T> {
  const fd = acquireRegistryLock(root)
  try {
    return await body()
  } finally {
    releaseRegistryLock(root, fd)
  }
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Puts the new app path into Orca's own serve unit of the profile. True when the unit changed. */
export function rewriteServeUnitAppPath(
  unitPath: string,
  oldPath: string,
  newPath: string
): boolean {
  if (!existsSync(unitPath)) {
    return false
  }
  const content = readFileSync(unitPath, 'utf8')
  const updated = content.split(xml(`${oldPath}/`)).join(xml(`${newPath}/`))
  if (updated === content) {
    return false
  }
  writeFileSync(unitPath, updated)
  return true
}

/** Puts the new port into the `--port` argument of Orca's own serve unit. True when it changed. */
export function rewriteServeUnitPort(unitPath: string, port: number): boolean {
  if (!existsSync(unitPath)) {
    return false
  }
  const content = readFileSync(unitPath, 'utf8')
  const updated = content.replace(
    /(<string>--port<\/string>\s*<string>)\d+(<\/string>)/,
    `$1${port}$2`
  )
  if (updated === content) {
    return false
  }
  writeFileSync(unitPath, updated)
  return true
}

/** True when path is inside parent after both resolve their links. */
export function isInside(path: string, parent: string): boolean {
  try {
    return realpathSync(path).startsWith(`${realpathSync(parent)}${sep}`)
  } catch {
    return false
  }
}

function samePath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return left === right
  }
}

/**
 * A rename in Finder changes only the app's file name. The app writes its new path and name to
 * the registry and to its own serve unit at start. The loaded service reads the unit again when
 * the app starts it at quit, so this installs and starts nothing.
 */
export function healAppProfileAppPath(options: {
  root: string
  id: string
  appPath: string
  unitPath: string
}): 'unchanged' | 'healed' {
  const entry = readAppProfileRegistry(options.root)?.profiles.find((p) => p.id === options.id)
  if (!entry || samePath(entry.appPath, options.appPath)) {
    return 'unchanged'
  }
  // A copy in Finder has the same id. The registry app keeps the profile while it carries the
  // id, and two apps without the registry app are not a rename: the registry stays.
  const located = locateAppProfileApp(entry)
  if (!located || !samePath(located, options.appPath)) {
    console.warn(
      `[profiles] ${options.appPath} has the id "${options.id}", but it is not the profile's app (${entry.appPath}). The registry stays.`
    )
    return 'unchanged'
  }
  return withRegistryLock(options.root, () => {
    const registry = readAppProfileRegistry(options.root)
    if (!registry) {
      return 'unchanged'
    }
    // The unit first: when its write fails, the registry keeps the old path, and the next start
    // tries both again.
    rewriteServeUnitAppPath(options.unitPath, entry.appPath, options.appPath)
    const name = basename(options.appPath, '.app')
    writeRegistry(options.root, {
      ...registry,
      profiles: registry.profiles.map((profile) =>
        profile.id === options.id ? { ...profile, name, appPath: options.appPath } : profile
      )
    })
    return 'healed'
  })
}
