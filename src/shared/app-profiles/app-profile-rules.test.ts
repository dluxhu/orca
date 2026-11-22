import { describe, expect, it } from 'vitest'
import {
  appProfileIdError,
  appProfileIdFromName,
  appProfileNameError,
  appProfilePortError,
  nextAppProfilePort
} from './app-profile-rules'

describe('app profile rules', () => {
  it('makes the id from the name without the word Orca', () => {
    expect(appProfileIdFromName('Orca - New Profile')).toBe('new-profile')
    expect(appProfileIdFromName('Orca @dLux - Todo-Dodo')).toBe('dlux-todo-dodo')
    expect(appProfileIdFromName('Orcas')).toBe('orcas')
    expect(appProfileIdFromName('Orca')).toBe('profile')
  })

  it('checks ids, names and ports', () => {
    expect(appProfileIdError('todo-dodo', ['work'])).toBeNull()
    expect(appProfileIdError('Work', ['work'])).toMatch('exists')
    expect(appProfileIdError('-a', [])).toMatch('letters')
    expect(appProfileIdError('all', [])).toMatch('reserved')
    expect(appProfileNameError('Orca - Work', ['Home'])).toBeNull()
    expect(appProfileNameError('a/b', [])).toMatch('"/"')
    expect(appProfileNameError(' home ', ['Home'])).toMatch('exists')
    expect(appProfilePortError(6832, [6800])).toBeNull()
    expect(appProfilePortError(6799, [])).toMatch('port range')
    expect(appProfilePortError(80, [])).toMatch('1024 to 65535')
  })

  it('gives the first free port of the series', () => {
    expect(nextAppProfilePort([])).toBe(6800)
    expect(nextAppProfilePort([6800, 6864])).toBe(6832)
    expect(nextAppProfilePort([6801])).toBe(6864)
  })
})
