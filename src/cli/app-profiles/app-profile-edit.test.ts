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

// Icons have their own tests; a profile here gets a fixed one.
const makeIcon = (() => ({
  icns: Buffer.from('icns 2'),
  icon: { kind: 'badge', text: '2', style: 'ref-match' }
})) as never
import { renameAppProfile, setAppProfilePort } from './app-profile-edit'
import { removeAppProfile } from './app-profile-remove'
import { listAppProfiles, serveServiceUnitOf } from './app-profile-list'
import { healAppProfileAppPath } from './app-profile-registry'
import { selectAppProfile } from './app-profile-selection'
import { setAppProfileIcon } from './app-profile-set-icon'
import { locateAppProfileApp } from '../../shared/app-profiles/app-profile-paths'

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
let failVerify: boolean

// Real ditto, plutil and cp; codesign, lsregister, launchctl, tccutil and security are recorded.
const run: RunTool = (program, args) => {
  calls.push([program, ...args])
  if (program.endsWith('codesign')) {
    if (args[0] === '--verify' && failVerify) {
      throw new Error('codesign --verify failed')
    }
    return args[0] === '-d' ? '<plist><dict/></plist>' : ''
  }
  if (/(lsregister|launchctl|tccutil|security)$/.test(program)) {
    return ''
  }
  return execFileSync(program, args, { encoding: 'utf8' })
}

const serviceRun: ServeServiceRun = async (_program, args) =>
  servicePid !== null && args[0] === 'print'
    ? { code: 0, out: `state = running\n\tpid = ${servicePid}\n` }
    : { code: 113, out: 'Could not find service' }

function file(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, { mode: 0o755 })
}

beforeEach(() => {
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
  failVerify = false
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
const plistValue = (path: string, key: string): string =>
  execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', path], { encoding: 'utf8' }).trim()

function makeProfile(name = 'Orca - Work', id?: string) {
  const entry = createAppProfile({ makeIcon, name, id, defaultAppPath: app, env: env(), run })
  calls = []
  return entry
}

function writeRuntimePid(userDataPath: string, pid: number): void {
  writeFileSync(join(userDataPath, 'orca-runtime.json'), JSON.stringify({ pid }))
}

describe.skipIf(process.platform !== 'darwin')('renameAppProfile', () => {
  it('renames the app and the registry name; the id, bundle id and data folder stay', async () => {
    const work = makeProfile()
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
    expect(plistValue(join(newPath, 'Contents', 'Info.plist'), 'CFBundleDisplayName')).toBe(
      'Orca - Job'
    )
    expect(plistValue(join(newPath, 'Contents', 'Info.plist'), 'CFBundleIdentifier')).toBe(
      work.bundleId
    )
    expect(registry().profiles).toEqual([
      expect.objectContaining({ id: 'work', name: 'Orca - Job', appPath: newPath })
    ])
    const sign = calls.find((call) => call[0].endsWith('codesign') && call[1] === '--force')
    expect(sign).toEqual(
      expect.arrayContaining(['-s', '-', '-i', work.bundleId, '--entitlements', newPath])
    )
    expect(sign).not.toContain('--deep')
    expect(calls).toContainEqual(['/usr/bin/codesign', '--verify', newPath])
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
    failVerify = true
    await expect(renameAppProfile({ id: 'work', name: 'Job', ...deps() })).rejects.toThrow(
      'codesign --verify failed'
    )
    expect(existsSync(work.appPath)).toBe(true)
    expect(existsSync(join(dir, 'apps', 'Job.app'))).toBe(false)
    expect(plistValue(join(work.appPath, 'Contents', 'Info.plist'), 'CFBundleDisplayName')).toBe(
      'Orca - Work'
    )
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
  it('cannot be renamed, removed or get another port', async () => {
    makeProfile()
    for (const attempt of [
      () => renameAppProfile({ id: 'default', name: 'Job', ...deps() }),
      () => removeAppProfile({ id: 'Default', keepData: false, trash: () => {}, ...deps() }),
      () => setAppProfilePort({ id: 'default', port: 7000, ...deps() })
    ]) {
      await expect(attempt()).rejects.toThrow('The default app is not a profile')
    }
    expect(calls).toEqual([])
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
      makeIcon,
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
      serviceRun: async (_program, args) =>
        args[1].endsWith(serveServiceUnitOf(home.userDataPath, false, dir).label)
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
    expect(rows[1]).toMatchObject({
      id: 'work',
      name: 'Orca - Finder',
      appPath: finderPath(),
      icon: { kind: 'badge', text: '2', style: 'ref-match' }
    })
  })

  it('set-icon writes the icon into the renamed app, also after a rename while the icon is made', async () => {
    renameInFinder()
    const later = join(dir, 'apps', 'Orca - Later.app')
    const icon = (path: string): string =>
      readFileSync(join(path, 'Contents', 'Resources', 'icon.icns'), 'utf8')
    const made = (text: string, move?: () => void) =>
      (() => {
        move?.()
        return {
          icns: Buffer.from(`icns ${text}`),
          icon: { kind: 'badge', text, style: 'ref-match' }
        }
      }) as never
    await setAppProfileIcon('work', { kind: 'badge' }, { ...deps(), makeIcon: made('Q') })
    expect(icon(finderPath())).toBe('icns Q')
    await setAppProfileIcon(
      'work',
      { kind: 'badge' },
      { ...deps(), makeIcon: made('R', () => renameSync(finderPath(), later)) }
    )
    expect(icon(later)).toBe('icns R')
    // The last bundle signature is on the app at its new place.
    expect(calls.findLast((call) => call[1] === '--force')?.at(-1)).toBe(later)
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
  })
})
