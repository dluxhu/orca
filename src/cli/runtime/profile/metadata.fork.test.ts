import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPlatformUserDataPath } from './metadata'

// Orca @dLux shares the profile of official Orca, so its CLI finds the same folder.
describe('the CLI profile folder in Orca @dLux', () => {
  it('is the official Orca folder', () => {
    expect(getPlatformUserDataPath('darwin', '/h')).toBe(
      join('/h', 'Library', 'Application Support', 'orca')
    )
  })
})
