import { execFile } from 'node:child_process'

import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const itRunsUnixShell = process.platform === 'win32' ? it.skip : it

const linuxLauncherAsset = new URL('../../../../resources/linux/bin/orca-ide', import.meta.url)
const darwinLauncherAsset = new URL('../../../../resources/darwin/bin/orca', import.meta.url)
const unixLauncherFixtures = [
  {
    name: 'Linux',
    asset: linuxLauncherAsset,
    appDir: ['Orca'],
    launcher: ['resources', 'bin', 'orca-ide'],
    executable: ['orca-ide'],
    cli: ['resources', 'app.asar.unpacked', 'out', 'cli', 'index.js']
  },
  // Two executable names, so a launcher that hardcodes one name fails.
  ...['Example App', 'Other Name'].map((executableName) => ({
    name: `macOS (${executableName})`,
    asset: darwinLauncherAsset,
    appDir: ['Example App.app'],
    launcher: ['Contents', 'Resources', 'bin', 'orca'],
    // The executable name follows productName; the launcher reads it from Info.plist.
    executable: ['Contents', 'MacOS', executableName],
    cli: ['Contents', 'Resources', 'app.asar.unpacked', 'out', 'cli', 'index.js']
  }))
]

function infoPlist(executable: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${executable}</string></dict></plist>
`
}

describe('packaged CLI assets', () => {
  itRunsUnixShell.each(unixLauncherFixtures)(
    'sanitizes node env and forwards argv verbatim through the $name launcher',
    async (launcherFixture) => {
      // The launcher resolves symlinks, and the macOS tmpdir is one (/var -> /private/var).
      const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-unix-cli-env-')))
      try {
        const appDir = join(root, ...launcherFixture.appDir)
        const launcherPath = join(appDir, ...launcherFixture.launcher)
        const electronPath = join(appDir, ...launcherFixture.executable)
        const cliPath = join(appDir, ...launcherFixture.cli)

        await mkdir(dirname(launcherPath), { recursive: true })
        await mkdir(dirname(electronPath), { recursive: true })
        await mkdir(dirname(cliPath), { recursive: true })
        await copyFile(launcherFixture.asset, launcherPath)
        await writeFile(cliPath, '', 'utf8')
        if (launcherFixture.asset === darwinLauncherAsset) {
          const executableName = launcherFixture.executable.at(-1) ?? ''
          await writeFile(join(appDir, 'Contents', 'Info.plist'), infoPlist(executableName), 'utf8')
          if (process.platform !== 'darwin') {
            // PlistBuddy exists only on macOS. A stub prints the executable name instead.
            const plistBuddy = join(root, 'PlistBuddy')
            await writeFile(plistBuddy, `#!/usr/bin/env bash\necho '${executableName}'\n`, {
              encoding: 'utf8',
              mode: 0o755
            })
            const launcher = await readFile(launcherPath, 'utf8')
            await writeFile(
              launcherPath,
              launcher.replace('/usr/libexec/PlistBuddy', plistBuddy),
              'utf8'
            )
          }
        }
        await writeFile(
          electronPath,
          `#!/usr/bin/env bash
node -e 'console.log(JSON.stringify({
  argv: process.argv.slice(1),
  runAsNode: process.env.ELECTRON_RUN_AS_NODE,
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  orcaNodeOptions: process.env.ORCA_NODE_OPTIONS ?? null,
  nodeReplExternalModule: process.env.NODE_REPL_EXTERNAL_MODULE ?? null,
  orcaNodeReplExternalModule: process.env.ORCA_NODE_REPL_EXTERNAL_MODULE ?? null
}))' -- "$@"
`,
          { encoding: 'utf8', mode: 0o755 }
        )

        const result = await execFileAsync(launcherPath, ['--help', 'two words'], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '0',
            NODE_OPTIONS: '--trace-warnings',
            NODE_REPL_EXTERNAL_MODULE: 'external-loader'
          }
        })
        const payload = JSON.parse(result.stdout) as {
          argv: string[]
          runAsNode: string
          nodeOptions: string | null
          orcaNodeOptions: string | null
          nodeReplExternalModule: string | null
          orcaNodeReplExternalModule: string | null
        }

        expect(payload.argv).toEqual([cliPath, '--help', 'two words'])
        expect(payload.runAsNode).toBe('1')
        // Hide node options from Electron's bootstrap but preserve them for the CLI.
        expect(payload.nodeOptions).toBeNull()
        expect(payload.orcaNodeOptions).toBe('--trace-warnings')
        expect(payload.nodeReplExternalModule).toBeNull()
        expect(payload.orcaNodeReplExternalModule).toBe('external-loader')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
