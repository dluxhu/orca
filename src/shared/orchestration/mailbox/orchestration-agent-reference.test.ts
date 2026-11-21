import { describe, expect, it } from 'vitest'
import { agentReferenceNote, splitAgentReferenceNotes } from './orchestration-agent-reference'

describe('splitAgentReferenceNotes', () => {
  it('splits the notes of every kind from the typed text', () => {
    const notes = [
      agentReferenceNote('Chat', 'orca_session_id:chat_aaaaaaaa', 'chat'),
      agentReferenceNote('Agent', 'term_a1', 'terminal'),
      agentReferenceNote('Shell', 'term_b2', 'shell'),
      agentReferenceNote('Crew (2)', 'dispatch:ctx_second')
    ]
    expect(
      splitAgentReferenceNotes(`@Chat @Agent @Shell @Crew (2)\n\n${notes.join('\n')}`)
    ).toEqual({
      body: '@Chat @Agent @Shell @Crew (2)',
      mentions: [
        { label: 'Chat', kind: 'chat' },
        { label: 'Agent', kind: 'terminal' },
        { label: 'Shell', kind: 'shell' },
        { label: 'Crew (2)', kind: null }
      ]
    })
  })

  it('keeps text whose last lines are not notes as they were written', () => {
    const note = agentReferenceNote('A', 'term_a1', 'terminal')
    expect(splitAgentReferenceNotes('@A')).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note}\nmore`)).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note.replace('--to', '--To')}`)).toBeNull()
    expect(splitAgentReferenceNotes(`@B\n\n${note}`)).toBeNull()
  })
})
