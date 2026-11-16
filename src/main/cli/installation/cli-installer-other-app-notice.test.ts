import { mkdir, mkdtemp, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from '../cli-installer'
import { otherMacAppBundle } from './cli-command-inspection'

async function writeLauncher(
  appBundle: string
): Promise<{ resourcesPath: string; launcher: string }> {
  const resourcesPath = join(appBundle, 'Contents', 'Resources')
  await mkdir(join(resourcesPath, 'bin'), { recursive: true })
  const launcher = join(resourcesPath, 'bin', 'orca')
  await writeFile(launcher, '#!/usr/bin/env bash\necho orca\n', { encoding: 'utf8', mode: 0o755 })
  return { resourcesPath, launcher }
}

// Fork patch: both apps own `orca`, so the fork says when it takes the link from the other app.
describe('CLI link owned by another Orca app', () => {
  it('finds the other .app bundle only when it differs from ours', () => {
    const ours = '/Applications/Orca @dLux.app/Contents/Resources/bin/orca'
    expect(otherMacAppBundle('/Applications/Orca.app/Contents/Resources/bin/orca', ours)).toBe(
      '/Applications/Orca.app'
    )
    expect(otherMacAppBundle(ours, ours)).toBeNull()
    expect(otherMacAppBundle('/usr/bin/orca', ours)).toBeNull()
    expect(otherMacAppBundle(null, ours)).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'warns before it replaces the link, and says what it replaced after',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'orca-cli-other-app-'))
      const officialApp = join(root, 'Orca.app')
      const official = await writeLauncher(officialApp)
      const fork = await writeLauncher(join(root, 'Orca @dLux.app'))
      const bin = join(root, 'usr', 'local', 'bin')
      await mkdir(bin, { recursive: true })
      const commandPath = join(bin, 'orca')
      await symlink(official.launcher, commandPath)

      const installer = new CliInstaller({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath: fork.resourcesPath,
        userDataPath: join(root, 'userData'),
        execPath: join(root, 'Orca @dLux.app', 'Contents', 'MacOS', 'Orca'),
        appPath: join(root, 'app'),
        homePath: join(root, 'home'),
        defaultMacCommandPath: commandPath,
        processPathEnv: bin
      })

      const before = await installer.getStatus()
      expect(before.state).toBe('stale')
      expect(before.detail).toBe(
        `${commandPath} belongs to another Orca app (${officialApp}). Register replaces it. To switch back, register the CLI again in that app.`
      )

      const after = await installer.install()
      expect(after.state).toBe('installed')
      expect(await readlink(commandPath)).toBe(fork.launcher)
      expect(after.detail).toBe(
        `Replaced the ${commandPath} link to ${officialApp}. To switch back, register the CLI again in that app.`
      )
    }
  )
})
