import { describe, expect, it } from 'vitest'
import { installedElectronCandidates } from './orcad-browser-provider'

describe('installedElectronCandidates', () => {
  // Fork patch: with official Orca also installed, headless orcad must start the fork's Electron.
  it('lists only the fork bundle on macOS', () => {
    expect(installedElectronCandidates('darwin', '/Users/me', {})).toEqual([
      '/Applications/Orca @dLux.app/Contents/MacOS/Orca @dLux',
      '/Users/me/Applications/Orca @dLux.app/Contents/MacOS/Orca @dLux'
    ])
  })
})
