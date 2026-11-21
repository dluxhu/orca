import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FORK_IDENTITY, withForkName } from '../../shared/fork-identity'
import { isOrcaAttributedPrompt } from '../macos-permissions/macos-tcc-prompt-watch'
import { ensureWindowsAppDataPath } from './windows-startup/windows-app-data-path'
import { RELEASE_CHANNELS, getReleaseRepoForChannel } from '../../shared/updater/release-channel'
import { getPlatformUserDataPath } from '../../cli/runtime/profile/metadata'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from '../../shared/remote-runtime/orcad-distribution/local-build-compatibility-contract'
import {
  getDevInstanceIdentity,
  shouldApplyPreReadyAppName
} from './profile-startup/dev-instance-identity'

const require = createRequire(import.meta.url)

// The fork installs beside official Orca, shares its profile, and updates from the fork.
describe('Orca @dLux fork identity', () => {
  it('names the fork, not official Orca', () => {
    expect(FORK_IDENTITY).toEqual({
      productName: 'Orca @dLux',
      appId: 'com.stablyai.orca.dlux',
      releaseRepo: 'dluxhu/orca'
    })
  })

  it('packages the fork identity and publishes to the fork releases', () => {
    const config = require('../../../config/electron-builder.config.cjs')
    expect(config.appId).toBe(FORK_IDENTITY.appId)
    expect(config.productName).toBe(FORK_IDENTITY.productName)
    // No package name override: the fork keeps the official `orca` userData folder.
    expect(config.extraMetadata?.name).toBeUndefined()
    expect(config.publish).toMatchObject({ provider: 'github', owner: 'dluxhu', repo: 'orca' })
  })

  it('updates every channel from the fork releases', () => {
    for (const channel of RELEASE_CHANNELS) {
      expect(getReleaseRepoForChannel(channel)).toBe('dluxhu/orca')
    }
  })

  it('uses the fork appId in the local-build contract, in TS and JSON', () => {
    expect(LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId).toBe(FORK_IDENTITY.appId)
    expect(
      require('../../shared/remote-runtime/orcad-distribution/local-build-compatibility-contract.json')
        .appId
    ).toBe(FORK_IDENTITY.appId)
  })

  it('gives the CLI the shared official profile folder', () => {
    expect(getPlatformUserDataPath('darwin', '/h')).toBe(
      join('/h', 'Library', 'Application Support', 'orca')
    )
  })

  it('keeps the package.json name as the packaged pre-ready name, so the Keychain item is "orca Safe Storage"', () => {
    const config = require('../../../config/electron-builder.config.cjs')
    expect(require('../../../package.json').name).toBe('orca')
    expect(config.extraMetadata?.name).toBeUndefined()
    expect(shouldApplyPreReadyAppName({ isDev: false })).toBe(false)
  })

  it('shows the fork name after ready and keeps the fork AppUserModelId', () => {
    expect(getDevInstanceIdentity(false)).toMatchObject({
      name: 'Orca @dLux',
      appName: 'Orca @dLux',
      appUserModelId: 'com.stablyai.orca.dlux'
    })
    expect(withForkName('About Orca')).toBe('About Orca @dLux')
    expect(withForkName('Orcas')).toBe('Orcas')
  })

  it('names the fork in the renderer page title', () => {
    expect(readFileSync(join(__dirname, '../../renderer/index.html'), 'utf8')).toContain(
      '<title>Orca @dLux</title>'
    )
  })

  it('resolves the Windows profile from the package.json name, as official Orca does', () => {
    const setPath = vi.fn()
    ensureWindowsAppDataPath(
      {
        getPath: () => 'C:\\Users\\u\\AppData\\Roaming',
        setPath,
        getName: () => require('../../../package.json').name,
        commandLine: { hasSwitch: () => false }
      },
      {},
      'win32'
    )
    expect(setPath).toHaveBeenCalledWith(
      'userData',
      win32.join('C:\\Users\\u\\AppData\\Roaming', 'orca')
    )
  })

  it('reports TCC prompts that the fork bundle or its helper is responsible for', () => {
    const service = 'kTCCServiceSystemPolicyDocumentsFolder'
    const prompt = (responsibleIdentifier: string) =>
      isOrcaAttributedPrompt({
        service,
        responsibleIdentifier,
        accessingIdentifier: 'x',
        binaryPath: '/x'
      })
    expect(prompt('com.stablyai.orca.dlux')).toBe(true)
    expect(prompt('com.stablyai.orca.dlux.helper')).toBe(true)
    expect(prompt('com.example.other')).toBe(false)
  })
})
