import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// A raw path into the user's home for `~/.orca` or an agent folder bypasses the app profile's own
// folders. Production code builds these paths through src/shared/app-profiles/app-profile-homes.ts.
const ROOT = join(__dirname, '..', '..', '..')
// `~/.orca` and the folder of each agent in APP_PROFILE_AGENT_HOME_VARIABLES.
const AGENT_DIRS =
  'orca|claude|claude\\.json|codex|grok|copilot|hermes|kimi-code|kiro|openclaw|mimocode|gemini|qwen|qoder|codebuddy|cline'
const RAW_PATTERNS = [
  // join(homedir(), '.claude'), os.homedir() + '.claude.json', over a line break too.
  new RegExp(`homedir\\(\\)[^;]{0,60}?['"\`/]\\.(${AGENT_DIRS})(?![\\w.-])`, 'g'),
  // `${HOME}/.codex`, `${HOME-}/.orca`, "$HOME/.claude"
  new RegExp(`\\$\\{?HOME-?\\}?"?\\/\\.(${AGENT_DIRS})(?![\\w-])`, 'g')
]
// The variable that moves each folder: a path that reads it first follows the profile.
const FOLDER_VARIABLE: Record<string, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  grok: 'GROK_HOME',
  copilot: 'COPILOT_HOME',
  hermes: 'HERMES_HOME',
  'kimi-code': 'KIMI_CODE_HOME',
  kiro: 'KIRO_HOME',
  openclaw: 'OPENCLAW_STATE_DIR',
  mimocode: 'MIMOCODE_HOME',
  gemini: 'GEMINI_CLI_HOME',
  qwen: 'QWEN_HOME',
  qoder: 'QODER_CONFIG_DIR',
  codebuddy: 'CODEBUDDY_CONFIG_DIR',
  cline: 'CLINE_DIR'
}
// Each entry says why the raw path is right there.
const ALLOWED: Record<string, string> = {
  'src/shared/app-profiles/app-profile-homes.ts': 'the helpers themselves',
  'src/main/orcad/host-runtime/orcad-app-paths.ts': "orcad's default data folder, not ~/.orca",
  'src/main/hermes/hermes-default-home.ts':
    'used only when HERMES_HOME is unset; a profile sets it',
  'src/main/agent-hooks/installation/commands/runtime-home-hook-command.ts':
    'hook commands; a profile installs no managed hooks',
  'src/main/codex/hooks/definitions/codex-hook-command-form.ts':
    'frozen Codex hook command bytes; a profile installs no managed hooks',
  'src/main/wsl/discovery/wsl-distro-holder-command.ts': "a WSL guest's own home",
  'src/main/ai-vault/scanners/opencode/reader-transport/opencode-wsl-runtime-preparation.ts':
    "a WSL guest's own home",
  'src/main/wsl/host-lifecycle/wsl-host-ssh-orcad-conflict.ts': "a WSL guest's own home",
  'src/main/wsl/host-lifecycle/wsl-host-uninstall-server-stop.ts': "a WSL guest's own home",
  'src/main/antigravity/antigravity-transcript-import.ts':
    'Antigravity has no folder variable; a profile installs no Antigravity hooks',
  'src/main/antigravity/native-wsl-credentials.ts': "a WSL guest's own home",
  'src/main/antigravity/hook-service.ts':
    'Antigravity has no folder variable; a profile installs no Antigravity hooks',
  'src/shared/shell/command-resolution/posix-version-manager-bin-dirs.ts':
    'the grok binary folder on PATH, not its config'
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === 'testing' ? [] : productionFiles(path)
    }
    return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) && !/\.(test|spec)\.|fixture/.test(name)
      ? [path]
      : []
  })
}

describe('paths into the home folder', () => {
  it('go through the app profile helpers', () => {
    const raw: string[] = []
    for (const file of productionFiles(join(ROOT, 'src'))) {
      const path = relative(ROOT, file)
      if (ALLOWED[path]) {
        continue
      }
      const text = readFileSync(file, 'utf8')
      for (const pattern of RAW_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          const line = text.slice(
            text.lastIndexOf('\n', match.index) + 1,
            text.indexOf('\n', match.index + match[0].length)
          )
          const variable = FOLDER_VARIABLE[match[1]]
          if (variable && line.includes(variable)) {
            continue
          }
          raw.push(`${path}: ${line.trim()}`)
        }
      }
    }
    expect(raw).toEqual([])
  })
})
