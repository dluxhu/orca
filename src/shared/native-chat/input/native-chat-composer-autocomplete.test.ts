import { describe, expect, it } from 'vitest'
import {
  deriveComposerAutocomplete,
  isSkillPickerTriggered,
  removeMentionToken
} from './native-chat-composer-autocomplete'
import type { SlashCommandSuggestion } from './native-chat-slash-commands'

import type { DiscoveredSkill } from '../../skills'
import { getNativeChatAgentProfile } from '../native-chat-agent-profiles'

const COMMANDS: SlashCommandSuggestion[] = [
  { name: 'clear' },
  { name: 'compact' },
  { name: 'help' }
]

function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: overrides.name ?? 'skill',
    name: 'typescript',
    description: null,
    providers: ['codex'],
    sourceKind: 'repo',
    sourceLabel: 'Repository',
    rootPath: '/repo/.agents/skills',
    directoryPath: '/repo/.agents/skills/typescript',
    skillFilePath: '/repo/.agents/skills/typescript/SKILL.md',
    installed: true,
    updatedAt: null,
    ...overrides
  }
}

describe('deriveComposerAutocomplete — one grammar for every agent', () => {
  const skills = [
    skill({ name: 'typescript' }),
    skill({ name: 'react-useeffect', directoryPath: '/repo/.agents/skills/react-useeffect' })
  ]
  const codex = getNativeChatAgentProfile('codex')

  // `echo $HOME` + Enter once swapped `$HOME` for a skill whose description named $CODEX_HOME.
  it.each(['echo $HOME', 'costs $5', 'run $(pwd)'])('leaves shell `$` in %j as prose', (draft) => {
    expect(isSkillPickerTriggered(draft, codex)).toBe(false)
    expect(deriveComposerAutocomplete(draft, draft.length, COMMANDS, skills, codex).mode).toBe(
      'none'
    )
  })
})

describe('removeMentionToken', () => {
  it('deletes only the @ token before the caret', () => {
    expect(removeMentionToken('ask @rel now', 8)).toEqual({ draft: 'ask  now', caret: 4 })
    expect(removeMentionToken('@rel', 4)).toEqual({ draft: '', caret: 0 })
    expect(removeMentionToken('mail a@b', 8)).toEqual({ draft: 'mail a@b', caret: 8 })
  })
})
