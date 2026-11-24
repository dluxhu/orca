import { describe, expect, it } from 'vitest'
import {
  appProfileIdError,
  appProfileIdFromName,
  appProfileNameError,
  appPortWarning,
  appProfilePortError,
  defaultAppPortError,
  nextAppProfilePort
} from './app-profile-rules'

describe('app profile rules', () => {
  it('makes the id from the name without the word Orca', () => {
    expect(appProfileIdFromName('Orca - New Profile')).toBe('new-profile')
    expect(appProfileIdFromName('Orca @Home - Client-X')).toBe('home-client-x')
    expect(appProfileIdFromName('Orcas')).toBe('orcas')
    expect(appProfileIdFromName('Orca')).toBe('profile')
  })

  it('checks ids, names and ports', () => {
    expect(appProfileIdError('client-x', ['work'])).toBeNull()
    for (const id of ['..', '.x', 'a/b', 'a.b', 'a_b', 'x'.repeat(33)]) {
      expect(appProfileIdError(id, [])).toMatch('letters')
    }
    expect(appProfileIdError('x'.repeat(32), [])).toBeNull()
    expect(appProfileIdError('Work', ['work'])).toMatch('exists')
    expect(appProfileIdError('-a', [])).toMatch('letters')
    expect(appProfileIdError('all', [])).toMatch('reserved')
    expect(appProfileNameError('Orca - Work', ['Home'])).toBeNull()
    expect(appProfileNameError('a/b', [])).toMatch('"/"')
    // A leading "-" would be an option of `orca profiles`.
    for (const name of ['--settings-file', '-x', '.hidden']) {
      expect(appProfileNameError(name, [])).toMatch('first')
    }
    expect(appProfileNameError(' home ', ['Home'])).toMatch('exists')
    expect(appProfilePortError(6832, [6800])).toBeNull()
    // The default app's saved port is taken; the ports near it only warn.
    expect(appProfilePortError(6768, [])).toMatch('port range')
    expect(appProfilePortError(6799, [])).toBeNull()
    expect(appProfilePortError(80, [])).toMatch('1024 to 65535')
  })

  it('warns about a port that a desktop app or a nearby server can take first, both ways', () => {
    expect(appPortWarning(6768, [])).toMatch('6768 to 6799')
    expect(appPortWarning(6799, [])).toMatch('6768 to 6799')
    // A profile near the default app's saved port, and the default app near a profile's.
    expect(appPortWarning(6830, [6800])).toMatch('31 ports')
    expect(appPortWarning(6800, [6830])).toMatch('31 ports')
    expect(appPortWarning(6832, [6800])).toBeNull()
    expect(defaultAppPortError(6800, [6800])).toMatch('saves the port 6800')
    expect(defaultAppPortError(6801, [6800])).toBeNull()
  })

  it('gives the texts to the translate function', () => {
    const t = (key: string, _fallback: string, values?: Record<string, string | number>) =>
      `${key} ${JSON.stringify(values ?? {})}`
    expect(appProfileIdError('all', [], t)).toBe('profileManager.rule.idReserved {"id":"all"}')
    expect(appProfilePortError(80, [], t)).toBe('profileManager.rule.portRange {"port":80}')
    expect(appProfileNameError('Work', ['work'], t)).toBe(
      'profileManager.rule.nameTaken {"name":"Work"}'
    )
  })

  it('gives the first free port of the series', () => {
    expect(nextAppProfilePort([])).toBe(6800)
    expect(nextAppProfilePort([6800, 6864])).toBe(6832)
    expect(nextAppProfilePort([6801])).toBe(6864)
  })
})
