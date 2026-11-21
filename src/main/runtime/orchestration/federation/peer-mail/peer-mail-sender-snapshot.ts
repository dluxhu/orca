import { agentMessageSenderName } from '../../../../../shared/agent-session/journal/agent-session-message-source'
import { parseBotAvatar } from '../../../../../shared/bot-avatar'
import type { PeerMailSender } from '../../../../../shared/rpc-contract/orchestration/orchestration-peer-mail-params'
import { parseOrcaSessionAddress } from '../../../../../shared/agent-session/identity/orca-session-address'
import { isTerminalHandle } from '../../../../../shared/terminal/terminal-handle-prefix'

/** The card's sender for mail from a paired Orca, kept on the message: its label is the party, named by
 *  what that Orca sent. A click opens only through a host this window already has. */
export function peerMailSenderSnapshot(
  label: string,
  sender: PeerMailSender | undefined,
  ownInstallationId: string | undefined
): string | undefined {
  if (!sender) {
    return undefined
  }
  const host = agentMessageSenderName(sender.computer)
  return JSON.stringify({
    version: 1,
    sender: {
      party: { address: label, terminalHandle: null, orcaSessionId: null },
      name: agentMessageSenderName(sender.bot?.name ?? sender.name ?? label),
      ...(sender.agent ? { agent: sender.agent } : {}),
      ...(sender.bot ? { bot: true } : {}),
      ...(portableAvatar(sender.bot?.avatar) ? { botAvatar: sender.bot?.avatar } : {}),
      ...(host ? { host } : {}),
      ...peerMailOrigin(sender, ownInstallationId)
    }
  })
}

/** Where the sender opens. A peer can name no chat of this Orca, and only a chat or terminal address.
 *  shortcut: a peer can still claim another Orca's id; upgrade when the pairing records the peer's id. */
function peerMailOrigin(
  sender: PeerMailSender,
  ownInstallationId: string | undefined
): { origin: { hostId: string; address: string } } | null {
  const { address, hostId } = sender
  return address &&
    hostId &&
    ownInstallationId &&
    hostId !== ownInstallationId &&
    (parseOrcaSessionAddress(address) !== null || isTerminalHandle(address))
    ? { origin: { hostId, address } }
    : null
}

const EMOJI = /^\p{Extended_Pictographic}/u

/** A mascot or emoji draws anywhere; an upload lives on the bot's own computer, so its initial shows. */
function portableAvatar(avatar: string | null | undefined): boolean {
  const parsed = parseBotAvatar(avatar ?? null)
  return (
    parsed?.kind === 'mascot' ||
    (parsed?.kind === 'emoji' && EMOJI.test(parsed.emoji) && parsed.emoji.length <= 16)
  )
}
