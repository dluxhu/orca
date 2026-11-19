import { describe, expect, it } from 'vitest'
import { resolveCycleAnchorWorktreeId } from './worktree-keyboard-cycle'

describe('resolveCycleAnchorWorktreeId', () => {
  it('takes the workspace of a chat place in the history', () => {
    const place = {
      kind: 'native-chat-quote',
      worktreeId: 'w1',
      tabId: 'tab-1',
      messageId: 'm1',
      chip: 0
    } as const
    expect(
      resolveCycleAnchorWorktreeId({
        activeWorktreeId: null,
        navHistory: ['w0', 'tasks', { ...place, at: 'chip' }, { ...place, at: 'source' }],
        navHistoryIndex: 3,
        worktreeIds: ['w0', 'w1']
      })
    ).toBe('w1')
  })
})
