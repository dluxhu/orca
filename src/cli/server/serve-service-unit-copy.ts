// Fork patch (app profiles): the serve LaunchAgent outside the login items.
// See docs/fork/profiles-design.md, section 4.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { serveUnitCopyPath } from '../../shared/app-profiles/app-profile-paths'

/** Moves the unit to its userData copy. True when the unit existed. */
export function keepServeUnitCopy(unitPath: string, userDataPath: string): boolean {
  if (!existsSync(unitPath)) {
    return false
  }
  mkdirSync(userDataPath, { recursive: true })
  renameSync(unitPath, serveUnitCopyPath(userDataPath))
  return true
}

export function removeServeUnitCopy(userDataPath: string): void {
  rmSync(serveUnitCopyPath(userDataPath), { force: true })
}
