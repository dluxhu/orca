import { describe, expect, it } from 'vitest'
import { agentReferenceNote, splitAgentReferenceNotes } from './orchestration-agent-reference'
import { agentReferenceDeliveryText } from './orchestration-agent-reference.test-fixture'

describe('splitAgentReferenceNotes', () => {
  it('splits the notes of every kind from the typed text', () => {
    const notes = [
      agentReferenceNote('Chat', 'orca_session_id:chat_aaaaaaaa', 'chat'),
      agentReferenceNote('Agent', 'term_a1', 'terminal'),
      agentReferenceNote('Shell', 'term_b2', 'shell')
    ]
    expect(splitAgentReferenceNotes(`@Chat @Agent @Shell\n\n${notes.join('\n')}`)).toEqual({
      body: '@Chat @Agent @Shell',
      mentions: [
        { label: 'Chat', kind: 'chat' },
        { label: 'Agent', kind: 'terminal' },
        { label: 'Shell', kind: 'shell' }
      ]
    })
    expect(splitAgentReferenceNotes(agentReferenceDeliveryText)?.mentions).toEqual([
      { label: 'Same name (2)', kind: null },
      { label: 'Same name (3)', kind: null }
    ])
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
        { label: 'Lead on Box (box)', kind: 'chat' },
        { label: 'Shell', kind: 'shell' },
        { label: 'Agent', kind: 'terminal' }
      ]
    })
    const note = agentReferenceNote('A', 'term_a1', 'terminal', 'box')
    expect(
      splitAgentReferenceNotes(`@A\n\n${note.replace('--on box', '--on other box')}`)
    ).toBeNull()
  })

  it('keeps text whose last lines are not notes as they were written', () => {
    const note = agentReferenceNote('A', 'term_a1', 'terminal')
    expect(splitAgentReferenceNotes('@A')).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note}\nmore`)).toBeNull()
    expect(splitAgentReferenceNotes(`@A\n\n${note.replace('--to', '--To')}`)).toBeNull()
    expect(splitAgentReferenceNotes(`@B\n\n${note}`)).toBeNull()
  })
})
