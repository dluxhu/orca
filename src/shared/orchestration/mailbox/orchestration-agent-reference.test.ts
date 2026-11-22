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
        { label: 'Chat', kind: 'chat', address: 'orca_session_id:chat_aaaaaaaa' },
        { label: 'Agent', kind: 'terminal', address: 'term_a1' },
        { label: 'Shell', kind: 'shell', address: 'term_b2' },
        { label: 'Crew (2)', kind: null, address: 'dispatch:ctx_second' }
      ]
    })
  })

  it('splits the notes for sessions on another host', () => {
    const notes = [
      agentReferenceNote('Lead on Box (box)', 'orca_session_id:chat_aaaaaaaa', 'chat', 'box'),
      agentReferenceNote('Shell', 'term_b2', 'shell', "it's mine"),
      agentReferenceNote('Agent', 'term_a1', 'terminal', '-dash')
    ]
    expect(
      splitAgentReferenceNotes(`to @Lead on Box (box), @Shell @Agent\n\n${notes.join('\n')}`)
    ).toEqual({
      body: 'to @Lead on Box (box), @Shell @Agent',
      mentions: [
        {
          label: 'Lead on Box (box)',
          kind: 'chat',
          address: 'orca_session_id:chat_aaaaaaaa',
          environment: 'box'
        },
        { label: 'Shell', kind: 'shell', address: 'term_b2', environment: "it's mine" },
        { label: 'Agent', kind: 'terminal', address: 'term_a1', environment: '-dash' }
      ]
    })
    const note = agentReferenceNote('A', 'term_a1', 'terminal', 'box')
    expect(
      splitAgentReferenceNotes(`@A\n\n${note.replace('--on box', '--on other box')}`)
    ).toBeNull()
  })

  it('splits only the last blank line from the notes', () => {
    const note = agentReferenceNote('A', 'term_a1', 'terminal')
    expect(splitAgentReferenceNotes(`p1\n\np2 @A\n\n${note}`)).toEqual({
      body: 'p1\n\np2 @A',
      mentions: [{ label: 'A', kind: 'terminal', address: 'term_a1' }]
    })
  })

  it('splits the notes of a goal from the end of its one line', () => {
    const a = agentReferenceNote('A', 'term_a1', 'terminal')
    const b = agentReferenceNote('B', 'orca_session_id:chat_aaaaaaaa', 'chat')
    expect(splitAgentReferenceNotes(`do @A [x] and @B ${a} ${b}`, 'goal')).toEqual({
      body: 'do @A [x] and @B',
      mentions: [
        { label: 'A', kind: 'terminal', address: 'term_a1' },
        { label: 'B', kind: 'chat', address: 'orca_session_id:chat_aaaaaaaa' }
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
