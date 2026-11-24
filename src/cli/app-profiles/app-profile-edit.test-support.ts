import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import type { ServeServiceRun } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { createAppProfile, type RunTool } from './app-profile-create'

const DEFAULT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.stablyai.orca.dlux</string>
  <key>CFBundleExecutable</key><string>Orca</string>
  <key>CFBundleName</key><string>Orca</string>
  <key>CFBundleDisplayName</key><string>Orca @dLux</string>
</dict>
</plist>
`

export let dir: string
export let app: string
export let calls: string[][]
/** For each `lsregister -f`: true when its bundle exists at that time. */
export let registeredBundleExists: boolean[] = []

/** The serve service job and the lsregister failure that a test file sets. */
export const serviceState: { pid: () => number | null; failRegister: () => boolean } = {
  pid: () => null,
  failRegister: () => false
}

// Real ditto, plutil and cp; codesign, lsregister, launchctl, tccutil and security are recorded.
export const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('lsregister') && args[0] === '-f') {
    registeredBundleExists.push(existsSync(args[1]))
  }
  if (program.endsWith('codesign')) {
    return args[0] === '-d' ? '<plist><dict/></plist>' : ''
  }
  if (program.endsWith('lsregister') && args[0] === '-f' && serviceState.failRegister()) {
    throw new Error('lsregister -f failed')
  }
  if (/(lsregister|launchctl|tccutil|security)$/.test(program)) {
    return ''
  }
  return execFileSync(program, args, { encoding: 'utf8' })
}

/** The fake process table that `ps -o ppid=,etime=` reads, by pid: "<ppid> <etime>". */
export let processes: Map<number, string>

export const serviceRun: ServeServiceRun = async (program, args) => {
  if (program === '/bin/ps') {
    const row = processes.get(Number(args.at(-1)))
    return row ? { code: 0, out: `${row}\n` } : { code: 1, out: '' }
  }
  const servicePid = serviceState.pid()
  return servicePid !== null && args[0] === 'print'
    ? { code: 0, out: `state = running\n\tpid = ${servicePid}\n` }
    : { code: 113, out: 'Could not find service' }
}

export function file(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, { mode: 0o755 })
}

/** Makes a fresh default app and temp home before each test, and removes them after it. */
export function installProfileEditHarness(): void {
  beforeEach(() => {
    registeredBundleExists = []
    dir = mkdtempSync(join(tmpdir(), 'orca-profile-edit-'))
    app = join(dir, 'Orca.app')
    const contents = join(app, 'Contents')
    file(join(contents, 'Info.plist'), DEFAULT_PLIST)
    file(join(contents, 'MacOS', 'Orca'), 'main')
    file(join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'x'), 'fw')
    file(join(contents, 'Resources', 'app.asar'), 'asar')
    file(join(contents, 'Resources', 'profile-template', 'orca-notification-status'), 'variant')
    file(join(contents, 'MacOS', 'orca-notification-status'), 'default variant')
    calls = []
    processes = new Map()
    vi.stubEnv('HOME', dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })
}

export const env = (): NodeJS.ProcessEnv => ({
  ORCA_PROFILES_ROOT: join(dir, 'data'),
  ORCA_PROFILES_APPS_DIR: join(dir, 'apps')
})
export const registry = (): {
  urlHandler: unknown
  profiles: { id: string; name: string; appPath: string; port: number }[]
} => JSON.parse(readFileSync(join(dir, 'data', 'profiles.json'), 'utf8'))
export const deps = () => ({
  env: env(),
  home: dir,
  uid: 501,
  run,
  serviceRun,
  isAlive: () => true
})
export const read = (path: string): string => readFileSync(path, 'utf8')

export function makeProfile(name = 'Orca - Work', id?: string) {
  const entry = createAppProfile({ name, id, defaultAppPath: app, env: env(), run })
  calls = []
  return entry
}

/**
 * A live process owns the profile's runtime file, as the owner writes it: `role` 'app' (the
 * default), 'serve' or 'orcad'; no role for a file of an older version. `etime`: the elapsed
 * time that `ps` gives for the pid. `runtime`: more fields of orca-runtime.json.
 */
export function writeRuntimePid(
  userDataPath: string,
  pid: number,
  options: { role?: string | null; ppid?: number; etime?: string; runtime?: object } = {}
): void {
  const role = options.role === undefined ? 'app' : options.role
  writeFileSync(
    join(userDataPath, 'orca-runtime.json'),
    JSON.stringify({ pid, ...(role === null ? {} : { role, userDataPath }), ...options.runtime })
  )
  processes.set(pid, `${options.ppid ?? 1} ${options.etime ?? '00:01'}`)
}
