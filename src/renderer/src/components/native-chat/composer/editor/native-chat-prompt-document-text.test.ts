import { describe, expect, it } from 'vitest'
import {
  BOT_MENTION_NODE,
  promptLeafString,
  promptTextContent
} from './native-chat-prompt-document-text'

// A bot on this computer, picked in a paired server's chat.
const CLIENT_TOKEN = '[Bot: Tech Lead](bot:lead-1@client:inst-1)'

describe('a bot on a paired computer in the composer', () => {
  it('becomes a bot pill, not plain text', () => {
    const [line] = promptTextContent(`Ask ${CLIENT_TOKEN} now`).content ?? []
    expect(line?.content).toEqual([
      { type: 'text', text: 'Ask ' },
      {
        type: BOT_MENTION_NODE,
        attrs: { id: 'lead-1', name: 'Tech Lead', chatId: '', server: '', client: 'inst-1' }
      },
      { type: 'text', text: ' now' }
    ])
  })

  it('sends the same token, so the server can reach the bot', () => {
    const [line] = promptTextContent(CLIENT_TOKEN).content ?? []
    const pill = line?.content?.[0]
    expect(promptLeafString(pill?.type, pill?.attrs)).toBe(CLIENT_TOKEN)
  })
})
