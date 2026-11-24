import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServeServiceRun } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { createAppProfile, type RunTool } from './app-profile-create'
import { renameAppProfile, setAppProfilePort } from './app-profile-edit'
import { removeAppProfile } from './app-profile-remove'
import { setDefaultAppPort } from './app-profile-default-port'
import { listAppProfiles, serveServiceUnitOf } from './app-profile-list'
import { healAppProfileAppPath } from './app-profile-registry'
import { selectAppProfile } from './app-profile-selection'
import { locateAppProfileApp, savedAppPort } from '../../shared/app-profiles/app-profile-paths'

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

let dir: string
let app: string
let calls: string[][]
/** The pid of the loaded serve service job, or null when launchctl knows no job. */
let servicePid: number | null
let failRegister: boolean
/** For each `lsregister -f`: true when its bundle exists at that time. */
let registeredBundleExists: boolean[] = []

// Real ditto, plutil and cp; codesign, lsregister, launchctl, tccutil and security are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('lsregister') && args[0] === '-f') {
    registeredBundleExists.push(existsSync(args[1]))
  }
  if (program.endsWith('codesign')) {
    return args[0] === '-d' ? '<plist><dict/></plist>' : ''
  }
  if (program.endsWith('lsregister') && args[0] === '-f' && failRegister) {
    throw new Error('lsregister -f failed')
  }
  if (/(lsregister|launchctl|tccutil|security)$/.test(program)) {
    return ''
  }
  return execFileSync(program, args, { encoding: 'utf8' })
}

/** The fake process table that `ps -o ppid=,command=` reads, by pid. */
let processes: Map<number, string>

const serviceRun: ServeServiceRun = async (program, args) => {
  if (program === '/bin/ps') {
    const row = processes.get(Number(args.at(-1)))
    return row ? { code: 0, out: `${row}\n` } : { code: 1, out: '' }
  }
  return servicePid !== null && args[0] === 'print'
    ? { code: 0, out: `state = running\n\tpid = ${servicePid}\n` }
    : { code: 113, out: 'Could not find service' }
}

function file(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, { mode: 0o755 })
}

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
  servicePid = null
  processes = new Map()
  failRegister = false
  vi.stubEnv('HOME', dir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const env = (): NodeJS.ProcessEnv => ({
  ORCA_PROFILES_ROOT: join(dir, 'data'),
  ORCA_PROFILES_APPS_DIR: join(dir, 'apps')
})
const registry = (): {
  urlHandler: unknown
  profiles: { id: string; name: string; appPath: string; port: number }[]
} => JSON.parse(readFileSync(join(dir, 'data', 'profiles.json'), 'utf8'))
const deps = () => ({ env: env(), home: dir, uid: 501, run, serviceRun, isAlive: () => true })
const read = (path: string): string => readFileSync(path, 'utf8')

function makeProfile(name = 'Orca - Work', id?: string) {
  const entry = createAppProfile({ name, id, defaultAppPath: app, env: env(), run })
  calls = []
  return entry
}

/**
 * A live process of the profile owns its runtime: its app, or its server with `args` '--serve'.
 * `runtime`: more fields of orca-runtime.json.
 */
function writeRuntimePid(
  userDataPath: string,
  pid: number,
  options: { args?: string; ppid?: number; runtime?: object } = {}
): void {
  writeFileSync(
    join(userDataPath, 'orca-runtime.json'),
    JSON.stringify({ pid, ...options.runtime })
  )
  const args = options.args ? ` ${options.args}` : ''
  processes.set(
    pid,
    `${options.ppid ?? 1} /Apps/Orca.app/Contents/MacOS/Orca${args} --user-data-dir=${userDataPath}`
  )
}

describe.skipIf(process.platform !== 'darwin')('renameAppProfile', () => {
  it('renames the app and the registry name; the id, bundle id and data folder stay', async () => {
    const work = makeProfile()
    const plistBefore = read(join(work.appPath, 'Contents', 'Info.plist'))
    const result = await renameAppProfile({ id: 'work', name: 'Orca - Job', ...deps() })
    const newPath = join(dir, 'apps', 'Orca - Job.app')
    expect(result).toMatchObject({
      id: 'work',
      name: 'Orca - Job',
      bundleId: work.bundleId,
      userDataPath: work.userDataPath,
      appPath: newPath,
      serveService: 'none'
    })
    expect(existsSync(work.appPath)).toBe(false)
    // The signed contents stay as create made them.
    expect(read(join(newPath, 'Contents', 'Info.plist'))).toBe(plistBefore)
    expect(registry().profiles).toEqual([
      expect.objectContaining({ id: 'work', name: 'Orca - Job', appPath: newPath })
    ])
    expect(calls.filter((call) => /codesign|plutil/.test(call[0]))).toEqual([])
    const lsregister = calls.filter((call) => call[0].endsWith('lsregister'))
    expect(lsregister.map((call) => call.slice(1))).toEqual([
      ['-u', work.appPath],
      ['-f', newPath]
    ])
  })

  it('refuses while the profile app runs, and changes nothing', async () => {
    const work = makeProfile()
    writeRuntimePid(work.userDataPath, 4242)
    await expect(renameAppProfile({ id: 'work', name: 'Job', ...deps() })).rejects.toThrow(
      '"Orca - Work" runs.'
    )
    expect(existsSync(work.appPath)).toBe(true)
    expect(registry().profiles[0].name).toBe('Orca - Work')
  })

  it('refuses while a server that its own service did not start runs', async () => {
    const work = makeProfile()
    // The service job runs (pid 9), but the server that owns the runtime is not its child.
    servicePid = 9
    writeRuntimePid(work.userDataPath, 4242, { args: '--serve' })
    await expect(renameAppProfile({ id: 'work', name: 'Job', ...deps() })).rejects.toThrow(
      'Stop that server'
    )
    await expect(
      removeAppProfile({ id: 'work', keepData: true, trash: () => {}, ...deps() })
    ).rejects.toThrow('Stop that server')
    expect(existsSync(work.appPath)).toBe(true)
  })

  it("restarts the profile's own supervised service: its server is the job's grandchild", async () => {
    const work = makeProfile()
    file(serveServiceUnitOf(work.userDataPath, false, dir).unitPath, 'unit')
    servicePid = 9
    writeRuntimePid(work.userDataPath, 10, { args: '--serve', ppid: 11 })
    processes.set(11, '9 /Apps/orca serve --supervise')
    const result = await renameAppProfile({ id: 'work', name: 'Job', ...deps() })
    expect(result.serveService).toBe('restarted')
  })

  it('updates the app path in the serve unit, and stops and starts a running service', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(
      unit.unitPath,
      `<string>${work.appPath}/Contents/MacOS/Orca</string><string>${work.userDataPath}</string>`
    )
    servicePid = 777
    writeRuntimePid(work.userDataPath, 777)
    const result = await renameAppProfile({ id: 'work', name: 'Job', ...deps() })
    expect(result.serveService).toBe('restarted')
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${join(dir, 'apps', 'Job.app')}/Contents/MacOS/Orca</string><string>${work.userDataPath}</string>`
    )
    const launchctl = calls.filter((call) => call[0].endsWith('launchctl')).map((c) => c[1])
    expect(launchctl).toEqual(['bootout', 'bootstrap'])
    // The service never gets a new unit of its own.
    expect(calls.some((call) => call.includes('install'))).toBe(false)
  })

  it('updates a unit whose app path has a double quote, as the unit renderer escapes it', async () => {
    const bob = makeProfile('Bob "B"', 'bob')
    const unit = serveServiceUnitOf(bob.userDataPath, false, dir)
    const escaped = (path: string) => path.replace(/"/g, '&quot;')
    file(unit.unitPath, `<string>${escaped(bob.appPath)}/Contents/Resources/bin/orca</string>`)
    const result = await renameAppProfile({ id: 'bob', name: 'Job', ...deps() })
    expect(result.serveService).toBe('updated')
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${join(dir, 'apps', 'Job.app')}/Contents/Resources/bin/orca</string>`
    )
  })

  it('puts the app back under its old name when a step fails', async () => {
    const work = makeProfile()
    failRegister = true
    await expect(renameAppProfile({ id: 'work', name: 'Job', ...deps() })).rejects.toThrow(
      'lsregister -f failed'
    )
    expect(existsSync(work.appPath)).toBe(true)
    expect(existsSync(join(dir, 'apps', 'Job.app'))).toBe(false)
    expect(registry().profiles[0]).toMatchObject({ name: 'Orca - Work', appPath: work.appPath })
  })

  it('refuses a name that another profile has', async () => {
    makeProfile()
    makeProfile('Home')
    await expect(renameAppProfile({ id: 'work', name: 'home', ...deps() })).rejects.toThrow(
      'A profile with the name "home" exists.'
    )
  })
})

describe.skipIf(process.platform !== 'darwin')('the default app', () => {
  const defaultData = (): string => join(dir, 'default-data')

  it('cannot be renamed or removed', async () => {
    makeProfile()
    for (const attempt of [
      () => renameAppProfile({ id: 'default', name: 'Job', ...deps() }),
      () => removeAppProfile({ id: 'Default', keepData: false, trash: () => {}, ...deps() })
    ]) {
      await expect(attempt()).rejects.toThrow('The default app is not a profile')
    }
    expect(calls).toEqual([])
  })

  it('saves its own port; a profile may then take the built-in 6768', async () => {
    const work = makeProfile()
    const result = await setDefaultAppPort({
      port: 6769,
      defaultUserDataPath: defaultData(),
      ...deps()
    })
    expect(result).toMatchObject({ id: 'default', port: 6769, serveService: 'none' })
    expect(JSON.parse(read(join(dir, 'data', 'profiles.json'))).defaultPort).toBe(6769)
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: defaultData(),
      ...deps()
    })
    expect(rows[0]).toMatchObject({ id: 'default', port: 6769 })
    expect(savedAppPort(defaultData(), env(), dir)).toBe(6769)
    expect(savedAppPort(work.userDataPath, env(), dir)).toBe(6800)
    // The default app's range follows its saved port.
    await setAppProfilePort({ id: 'work', port: 6768, ...deps() })
    expect(registry().profiles[0].port).toBe(6768)
    // A profile keeps the saved ports of other profiles: no rewrite of its entry.
    expect(JSON.parse(read(join(dir, 'data', 'profiles.json'))).defaultPort).toBe(6769)
  })

  it('refuses the saved port of a profile', async () => {
    makeProfile()
    await expect(
      setDefaultAppPort({ port: 6800, defaultUserDataPath: defaultData(), ...deps() })
    ).rejects.toThrow('Another profile saves the port 6800.')
    expect(JSON.parse(read(join(dir, 'data', 'profiles.json'))).defaultPort).toBeUndefined()
  })

  it('moves its loaded Start at login service to the new port', async () => {
    makeProfile()
    const unit = serveServiceUnitOf(defaultData(), true, dir)
    file(unit.unitPath, '<string>--port</string>\n    <string>6768</string>')
    servicePid = 777
    const result = await setDefaultAppPort({
      port: 6769,
      defaultUserDataPath: defaultData(),
      ...deps()
    })
    expect(result.serveService).toBe('restarted')
    expect(read(unit.unitPath)).toContain('<string>6769</string>')
  })
})

describe.skipIf(process.platform !== 'darwin')('setAppProfilePort', () => {
  it('moves an installed Start at login service that is not loaded to the new port', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, '<string>--port</string>\n    <string>6800</string>')
    const result = await setAppProfilePort({ id: 'work', port: 7000, ...deps() })
    expect(result).toMatchObject({ serveServiceInstalled: true, serveService: 'updated' })
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      '<string>--port</string>\n    <string>7000</string>'
    )
    expect(calls.filter((call) => call[0].endsWith('launchctl'))).toEqual([])
  })

  it('keeps the registry and the unit on the old port when the unit write fails', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, '<string>--port</string>\n    <string>6800</string>')
    servicePid = 777
    chmodSync(unit.unitPath, 0o444)
    try {
      await expect(setAppProfilePort({ id: 'work', port: 7000, ...deps() })).rejects.toThrow(
        'EACCES'
      )
    } finally {
      chmodSync(unit.unitPath, 0o644)
    }
    expect(registry().profiles[0].port).toBe(6800)
    // The job runs again on the old unit.
    expect(calls.filter((call) => call[0].endsWith('launchctl')).map((call) => call[1])).toEqual([
      'bootout',
      'bootstrap'
    ])
  })

  it('stops before any change when the bootout fails', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, '<string>--port</string>\n    <string>6800</string>')
    servicePid = 777
    const failing: RunTool = (program, args) => {
      if (args[0] === 'bootout') {
        throw new Error('bootout failed')
      }
      return run(program, args)
    }
    await expect(
      setAppProfilePort({ id: 'work', port: 7000, ...deps(), run: failing })
    ).rejects.toThrow('bootout failed')
    expect(readFileSync(unit.unitPath, 'utf8')).toContain('<string>6800</string>')
    expect(registry().profiles[0].port).toBe(6800)
  })

  it('restarts a loaded service on the new port, so the server keeps running', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, '<string>--port</string>\n    <string>6800</string>')
    servicePid = 777
    let portAtBootstrap = ''
    const recording: RunTool = (program, args) => {
      if (args[0] === 'bootstrap') {
        portAtBootstrap = readFileSync(unit.unitPath, 'utf8')
      }
      return run(program, args)
    }
    const result = await setAppProfilePort({ id: 'work', port: 7000, ...deps(), run: recording })
    expect(result.serveService).toBe('restarted')
    expect(calls.filter((call) => call[0].endsWith('launchctl')).map((call) => call[1])).toEqual([
      'bootout',
      'bootstrap'
    ])
    expect(portAtBootstrap).toContain('<string>7000</string>')
  })

  it('changes the saved port while the profile app is open; the app does not use it', async () => {
    const work = makeProfile()
    writeRuntimePid(work.userDataPath, 4242)
    const result = await setAppProfilePort({ id: 'work', port: 7000, ...deps() })
    expect(result.port).toBe(7000)
    expect(registry().profiles[0].port).toBe(7000)
  })

  it('refuses the saved port of another profile and the default port', async () => {
    makeProfile()
    makeProfile('Home')
    for (const port of [6800, 6768]) {
      await expect(setAppProfilePort({ id: 'home', port, ...deps() })).rejects.toThrow(
        'inside the port range'
      )
    }
    expect(registry().profiles.map((p) => p.port)).toEqual([6800, 6832])
  })

  it('writes a valid port and refuses the range of another profile', async () => {
    makeProfile()
    makeProfile('Home')
    await expect(setAppProfilePort({ id: 'home', port: 6810, ...deps() })).rejects.toThrow(
      'inside the port range'
    )
    const result = await setAppProfilePort({ id: 'home', port: 7000, ...deps() })
    expect(result).toMatchObject({ port: 7000, serveServiceInstalled: false })
    expect(registry().profiles.map((p) => p.port)).toEqual([6800, 7000])
  })
})

describe.skipIf(process.platform !== 'darwin')('removeAppProfile', () => {
  const trashed: string[] = []
  const trash = (path: string): void => {
    trashed.push(path)
    renameSync(path, join(dir, `trash-${trashed.length}`))
  }
  beforeEach(() => {
    trashed.length = 0
  })

  it('moves the app and its data to the Trash and forgets the profile', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, 'unit')
    const data = JSON.parse(readFileSync(join(dir, 'data', 'profiles.json'), 'utf8'))
    data.urlHandler = { mode: 'profile', profileId: 'work' }
    writeFileSync(join(dir, 'data', 'profiles.json'), JSON.stringify(data))
    const result = await removeAppProfile({ id: 'work', keepData: false, trash, ...deps() })
    expect(result).toEqual({ id: 'work', keptData: false, serveService: 'removed' })
    expect(trashed).toEqual([work.appPath, work.userDataPath])
    expect(existsSync(unit.unitPath)).toBe(false)
    expect(registry()).toMatchObject({ urlHandler: { mode: 'ask' }, profiles: [] })
    expect(calls).toContainEqual(['/usr/bin/tccutil', 'reset', 'All', work.bundleId])
    expect(calls).toContainEqual([
      '/usr/bin/security',
      'delete-generic-password',
      '-s',
      'orca-work Safe Storage'
    ])
  })

  it('keeps the data folder and the Keychain item with keepData', async () => {
    const work = makeProfile()
    await removeAppProfile({ id: 'work', keepData: true, trash, ...deps() })
    expect(trashed).toEqual([work.appPath])
    expect(existsSync(join(work.userDataPath, 'orca-app-profile.json'))).toBe(true)
    expect(calls.some((call) => call[0].endsWith('security'))).toBe(false)
  })

  it('gives the kept data back to a new profile with the same id', async () => {
    const work = makeProfile()
    writeFileSync(join(work.userDataPath, 'orca-data.json'), 'old chats')
    await removeAppProfile({ id: 'work', keepData: true, trash, ...deps() })
    const again = createAppProfile({
      name: 'Orca - Work again',
      id: 'work',
      defaultAppPath: app,
      env: env(),
      run
    })
    expect(again).toMatchObject({ userDataPath: work.userDataPath, adoptedData: true })
    expect(readFileSync(join(work.userDataPath, 'orca-data.json'), 'utf8')).toBe('old chats')
    expect(registry().profiles.map((p) => p.id)).toEqual(['work'])
  })

  it('refuses while the profile app runs', async () => {
    const work = makeProfile()
    writeRuntimePid(work.userDataPath, 4242)
    await expect(
      removeAppProfile({ id: 'work', keepData: false, trash, ...deps() })
    ).rejects.toThrow('runs')
    expect(trashed).toEqual([])
  })
})

describe.skipIf(process.platform !== 'darwin')('listAppProfiles', () => {
  it('lists the default app first with the state of each profile', async () => {
    const work = makeProfile()
    const home = makeProfile('Home')
    makeProfile('Client')
    writeRuntimePid(work.userDataPath, 10)
    // Only the serve service runs for Home, and only Home has a unit (Start at login).
    writeRuntimePid(home.userDataPath, 20)
    file(serveServiceUnitOf(home.userDataPath, false, dir).unitPath, 'unit')
    servicePid = 20
    const defaultUserData = join(dir, 'default-data')
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: defaultUserData,
      ...deps(),
      serviceRun: async (program, args) =>
        program === '/bin/ps'
          ? serviceRun(program, args)
          : args[1].endsWith(serveServiceUnitOf(home.userDataPath, false, dir).label)
            ? { code: 0, out: 'pid = 20' }
            : { code: 113, out: '' }
    })
    expect(rows.map((row) => row.startAtLogin)).toEqual([false, false, true, false])
    expect(rows.map((row) => [row.id, row.name, row.state])).toEqual([
      ['default', 'Default', 'stopped'],
      ['work', 'Orca - Work', 'running'],
      ['home', 'Home', 'background'],
      ['client', 'Client', 'stopped']
    ])
  })

  it('classifies the owner of each runtime from its process', async () => {
    const work = makeProfile('Work')
    const home = makeProfile('Home')
    const client = makeProfile('Client')
    const flag = makeProfile('Flag')
    const reused = makeProfile('Reused')
    const stale = makeProfile('Stale')
    // The service job (9) is the supervisor (11); its child server owns the runtime.
    writeRuntimePid(work.userDataPath, 10, { args: '--serve', ppid: 11 })
    processes.set(11, '9 /Apps/orca serve --supervise')
    // A launch agent with another label starts this server.
    writeRuntimePid(home.userDataPath, 20, { args: '--serve' })
    writeRuntimePid(client.userDataPath, 30)
    // --serve-port is no --serve token.
    writeRuntimePid(flag.userDataPath, 40, { args: '--serve-port=6800' })
    // Another process took the pid of an old runtime file.
    writeRuntimePid(reused.userDataPath, 50)
    processes.set(50, '1 /usr/bin/vim notes.txt')
    // The pid of the runtime file is dead.
    writeRuntimePid(stale.userDataPath, 60, {
      runtime: { transports: [{ kind: 'websocket', endpoint: 'ws://0.0.0.0:6960' }] }
    })
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: join(dir, 'default-data'),
      ...deps(),
      isAlive: (pid) => pid !== 60,
      serviceRun: async (program, args) =>
        program === '/bin/ps' ||
        !args[1].endsWith(serveServiceUnitOf(work.userDataPath, false, dir).label)
          ? serviceRun(program, args)
          : { code: 0, out: 'pid = 9' }
    })
    expect(rows.map((row) => [row.id, row.state, row.livePort])).toEqual([
      ['default', 'stopped', undefined],
      ['work', 'background', undefined],
      ['home', 'background', undefined],
      ['client', 'running', undefined],
      ['flag', 'running', undefined],
      ['reused', 'stopped', undefined],
      ['stale', 'stopped', undefined]
    ])
  })

  it("gives the port of the profile's live app or server, not the saved port", async () => {
    const work = makeProfile()
    const home = makeProfile('Home')
    const client = makeProfile('Client')
    const ws = (endpoint: string) => ({ transports: [{ kind: 'websocket', endpoint }] })
    // A server started with --port 6768 runs on that port, not on the saved 6800.
    writeRuntimePid(work.userDataPath, 10, { args: '--serve', runtime: ws('ws://0.0.0.0:6768') })
    // The app listens on its own port.
    writeRuntimePid(home.userDataPath, 20, { runtime: ws('ws://127.0.0.1:6769') })
    // A file that a stopped server left gives no port.
    writeRuntimePid(client.userDataPath, 30, { runtime: ws('ws://0.0.0.0:6864') })
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: join(dir, 'default-data'),
      ...deps(),
      isAlive: (pid) => pid !== 30
    })
    expect(rows.map((row) => [row.id, row.port, row.livePort, row.state])).toEqual([
      ['default', 6768, undefined, 'stopped'],
      ['work', 6800, 6768, 'background'],
      ['home', 6832, 6769, 'running'],
      ['client', 6864, undefined, 'stopped']
    ])
  })
})

describe.skipIf(process.platform !== 'darwin')('a profile app renamed in Finder', () => {
  const finderPath = (): string => join(dir, 'apps', 'Orca - Finder.app')
  function renameInFinder() {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, `<string>${work.appPath}/Contents/Resources/bin</string>`)
    renameSync(work.appPath, finderPath())
    return { work, unit }
  }

  it('heals the registry and the serve unit at start, once, without a service install', () => {
    const { work, unit } = renameInFinder()
    const heal = () =>
      healAppProfileAppPath({
        root: join(dir, 'data'),
        id: 'work',
        appPath: finderPath(),
        unitPath: unit.unitPath
      })
    expect(heal()).toBe('healed')
    expect(registry().profiles[0]).toMatchObject({ name: 'Orca - Finder', appPath: finderPath() })
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${finderPath()}/Contents/Resources/bin</string>`
    )
    expect(heal()).toBe('unchanged')
    expect(registry().profiles[0]).toMatchObject({ id: 'work', userDataPath: work.userDataPath })
    expect(calls).toEqual([])
  })

  it('keeps the registry and the unit on the original when a Finder copy starts', () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, `<string>${work.appPath}/Contents/Resources/bin</string>`)
    const copy = join(dir, 'apps', 'Orca - Work copy.app')
    execFileSync('/bin/cp', ['-R', work.appPath, copy])
    const heal = (appPath: string) =>
      healAppProfileAppPath({
        root: join(dir, 'data'),
        id: 'work',
        appPath,
        unitPath: unit.unitPath
      })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(heal(copy)).toBe('unchanged')
    // The original is gone, but two apps have the id: Orca does not guess.
    renameSync(work.appPath, finderPath())
    expect(locateAppProfileApp({ id: 'work', appPath: work.appPath })).toBeNull()
    expect(heal(finderPath())).toBe('unchanged')
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(registry().profiles[0]).toMatchObject({ name: 'Orca - Work', appPath: work.appPath })
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${work.appPath}/Contents/Resources/bin</string>`
    )
    vi.mocked(console.warn).mockRestore()
  })

  it('tries the unit again at the next start when its write fails', () => {
    const { work, unit } = renameInFinder()
    const heal = () =>
      healAppProfileAppPath({
        root: join(dir, 'data'),
        id: 'work',
        appPath: finderPath(),
        unitPath: unit.unitPath
      })
    chmodSync(unit.unitPath, 0o444)
    try {
      expect(heal).toThrow('EACCES')
    } finally {
      chmodSync(unit.unitPath, 0o644)
    }
    expect(registry().profiles[0].appPath).toBe(work.appPath)
    expect(heal()).toBe('healed')
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${finderPath()}/Contents/Resources/bin</string>`
    )
  })

  it('lists the renamed app by its embedded id before it starts', async () => {
    renameInFinder()
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: join(dir, 'default-data'),
      ...deps()
    })
    expect(rows[1]).toMatchObject({ id: 'work', name: 'Orca - Finder', appPath: finderPath() })
  })

  it('serve, open and rename find the renamed app', async () => {
    renameInFinder()
    const cliEnv: NodeJS.ProcessEnv = { ...env(), ORCA_PROFILE: 'work' }
    selectAppProfile([], cliEnv)
    expect(cliEnv.ORCA_APP_EXECUTABLE).toBe(join(finderPath(), 'Contents', 'MacOS', 'Orca'))
    const result = await renameAppProfile({ id: 'work', name: 'Orca - Job', ...deps() })
    expect(result.appPath).toBe(join(dir, 'apps', 'Orca - Job.app'))
    expect(existsSync(finderPath())).toBe(false)
  })
})

describe.skipIf(process.platform !== 'darwin')("remove moves only what is the profile's", () => {
  const trashed: string[] = []
  const trash = (path: string): void => {
    trashed.push(path)
  }
  beforeEach(() => {
    trashed.length = 0
  })
  const tamper = (change: (profile: Record<string, unknown>) => void): void => {
    const path = join(dir, 'data', 'profiles.json')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    change(data.profiles[0])
    writeFileSync(path, JSON.stringify(data))
  }

  it('refuses a profiles.json that names a folder outside the profiles root', async () => {
    makeProfile()
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'orca-app-profile.json'), '{"id":"work"}')
    tamper((profile) => {
      profile.userDataPath = outside
    })
    await expect(
      removeAppProfile({ id: 'work', keepData: false, trash, ...deps() })
    ).rejects.toThrow('Orca does not move it')
    expect(trashed).toEqual([])
    expect(registry().profiles).toHaveLength(1)
  })

  it('refuses a data folder that is a link', async () => {
    const work = makeProfile()
    const outside = join(dir, 'outside')
    renameSync(work.userDataPath, outside)
    symlinkSync(outside, work.userDataPath)
    await expect(
      removeAppProfile({ id: 'work', keepData: false, trash, ...deps() })
    ).rejects.toThrow('Orca does not move it')
    expect(trashed).toEqual([])
  })

  it('refuses an app outside the apps folder', async () => {
    const work = makeProfile()
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere)
    renameSync(work.appPath, join(elsewhere, 'Orca - Work.app'))
    tamper((profile) => {
      profile.appPath = join(elsewhere, 'Orca - Work.app')
    })
    await expect(
      removeAppProfile({ id: 'work', keepData: true, trash, ...deps() })
    ).rejects.toThrow('Orca does not move it')
    expect(trashed).toEqual([])
  })
})

describe.skipIf(process.platform !== 'darwin')('edits hold the registry lock', () => {
  it('checks the running state while it holds the lock', async () => {
    makeProfile()
    const lock = join(dir, 'data', 'profiles.json.lock')
    const locked: boolean[] = []
    const checking: ServeServiceRun = async (program, args) => {
      locked.push(existsSync(lock))
      return serviceRun(program, args)
    }
    await removeAppProfile({
      id: 'work',
      keepData: true,
      trash: () => {},
      ...deps(),
      serviceRun: checking
    })
    expect(locked).toEqual([true])
    expect(existsSync(lock)).toBe(false)
  })
})

describe.skipIf(process.platform !== 'darwin')('rename rolls back a failed unit rewrite', () => {
  it('puts the app, Launch Services and the registry back', async () => {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, `<string>${work.appPath}/Contents/MacOS/Orca</string>`)
    chmodSync(unit.unitPath, 0o444)
    try {
      await expect(renameAppProfile({ id: 'work', name: 'Job', ...deps() })).rejects.toThrow(
        'EACCES'
      )
    } finally {
      chmodSync(unit.unitPath, 0o644)
    }
    const newPath = join(dir, 'apps', 'Job.app')
    expect(existsSync(work.appPath)).toBe(true)
    expect(existsSync(newPath)).toBe(false)
    expect(registry().profiles[0]).toMatchObject({ name: 'Orca - Work', appPath: work.appPath })
    expect(readFileSync(unit.unitPath, 'utf8')).toBe(
      `<string>${work.appPath}/Contents/MacOS/Orca</string>`
    )
    const lsregister = calls.filter((call) => call[0].endsWith('lsregister')).map((c) => c.slice(1))
    expect(lsregister.slice(-2)).toEqual([
      ['-u', newPath],
      ['-f', work.appPath]
    ])
    // The old bundle is back before Launch Services registers it.
    expect(registeredBundleExists.at(-1)).toBe(true)
  })
})
