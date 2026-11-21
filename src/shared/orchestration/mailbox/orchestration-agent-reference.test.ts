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

  it('splits only the last blank line from the notes', () => {
    const note = agentReferenceNote('A', 'term_a1', 'terminal')
    expect(splitAgentReferenceNotes(`p1\n\np2 @A\n\n${note}`)).toEqual({
      body: 'p1\n\np2 @A',
      mentions: [{ label: 'A', kind: 'terminal' }]
    })
  })

  it('splits the notes of a goal from the end of its one line', () => {
    const a = agentReferenceNote('A', 'term_a1', 'terminal')
    const b = agentReferenceNote('B', 'orca_session_id:chat_aaaaaaaa', 'chat')
    expect(splitAgentReferenceNotes(`do @A [x] and @B ${a} ${b}`, 'goal')).toEqual({
      body: 'do @A [x] and @B',
      mentions: [
        { label: 'A', kind: 'terminal' },
        { label: 'B', kind: 'chat' }
      ]
    })
    expect(splitAgentReferenceNotes(`do @A ${a}`)).toBeNull()
    expect(splitAgentReferenceNotes(`do @A ${a} more`, 'goal')).toBeNull()
  })

  it('keeps text whose last lines are not notes as they were written', () => {
    const note = agentReferenceNote('A', 'term_a1', 'terminal')
    expect(splitAgentReferenceNotes('@A')).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note}\nmore`)).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note.replace('--to', '--To')}`)).toBeNull()
    expect(splitAgentReferenceNotes(`@B\n\n${note}`)).toBeNull()
  })
})
