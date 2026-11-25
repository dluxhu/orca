import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServeServiceRun } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { renameAppProfile } from './app-profile-edit'
import { removeAppProfile } from './app-profile-remove'
import { listAppProfiles, serveServiceUnitOf } from './app-profile-list'
import { healAppProfileAppPath } from './app-profile-registry'
import { selectAppProfile } from './app-profile-selection'
import { setAppProfileIcon } from './app-profile-set-icon'
import { locateAppProfileApp } from '../../shared/app-profiles/app-profile-paths'
import {
  dir,
  app,
  calls,
  registeredBundleExists,
  serviceRun,
  file,
  installProfileEditHarness,
  registry,
  env,
  deps,
  makeProfile,
  writeRuntimePid
} from './app-profile-edit.test-support'

installProfileEditHarness()

describe.skipIf(process.platform !== 'darwin')('a profile app renamed in Finder', () => {
  const finderPath = (): string => join(dir, 'apps', 'Orca - Finder.app')
  function renameInFinder() {
    const work = makeProfile()
    const unit = serveServiceUnitOf(work.userDataPath, false, dir)
    file(unit.unitPath, `<string>${work.appPath}/Contents/Resources/bin</string>`)
    renameSync(work.appPath, finderPath())
    return { work, unit }
  }

  it('a running app renamed in Finder stays running, and remove refuses it', async () => {
    const work = makeProfile()
    writeRuntimePid(work.userDataPath, 4242)
    renameSync(work.appPath, finderPath())
    const rows = await listAppProfiles({
      defaultAppPath: app,
      defaultUserDataPath: join(dir, 'default-data'),
      ...deps()
    })
    expect(rows[1]).toMatchObject({ id: 'work', state: 'running' })
    const trash = (): void => {
      throw new Error('trashed a running app')
    }
    await expect(
      removeAppProfile({ id: 'work', keepData: false, trash, ...deps() })
    ).rejects.toThrow('runs')
    expect(existsSync(work.userDataPath)).toBe(true)
  })

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

  it('set-icon gives the renamed app its icon, also after a rename while the icon is made', async () => {
    renameInFinder()
    const later = join(dir, 'apps', 'Orca - Later.app')
    // The bundle of the last custom icon call.
    const iconTarget = (): string | undefined =>
      calls
        .findLast((call) => call[0] === '/usr/bin/env')
        ?.find((arg) => arg.startsWith('ORCA_APP_BUNDLE_PATH='))
        ?.slice('ORCA_APP_BUNDLE_PATH='.length)
    const made = (text: string, move?: () => void) =>
      (() => {
        move?.()
        return {
          icns: Buffer.from(`icns ${text}`),
          icon: { kind: 'badge', text, style: 'ref-match' }
        }
      }) as never
    await setAppProfileIcon('work', { kind: 'badge' }, { ...deps(), makeIcon: made('Q') })
    expect(iconTarget()).toBe(finderPath())
    await setAppProfileIcon(
      'work',
      { kind: 'badge' },
      { ...deps(), makeIcon: made('R', () => renameSync(finderPath(), later)) }
    )
    expect(iconTarget()).toBe(later)
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
