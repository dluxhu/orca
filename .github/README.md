# Orca @dLux

Orca @dLux is a fork of [Orca](https://github.com/stablyai/orca), the IDE for parallel
agentic development. It installs beside official Orca, and it shares the official Orca
profile. Use one of the two apps at a time.

## Download

Get the app from the [releases](https://github.com/dluxhu/orca/releases). The app updates
itself from the same releases.

The app is signed with a Developer ID, but Apple did not notarize it. macOS blocks the first
start. The releases are for Apple Silicon (arm64) Macs only. To open it: in Finder, Control-click the app, select **Open**, then select
**Open** again.

## How it is different from official Orca

|                              | Official Orca            | Orca @dLux                                 |
| ---------------------------- | ------------------------ | ------------------------------------------ |
| App name                     | Orca                     | Orca @dLux                                 |
| Bundle id                    | `com.stablyai.orca`      | `com.stablyai.orca.dlux`                   |
| Updates from                 | `stablyai/orca` releases | `dluxhu/orca` releases                     |
| Settings, sign-ins, projects | its profile              | the same profile and the same Keychain key |

On the first start, macOS asks if Orca @dLux can use the "orca Safe Storage" Keychain item.
Select **Always Allow**. Then your stored sign-ins work in both apps.

## Patches

Features:

- **Claude Code chat mode.** Turn Claude Remote Control on and off in a chat tab, and resume a Claude session by its id as a chat ([#3](https://github.com/dluxhu/orca/pull/3)).
- **Chat CLI.** `orca chat list`, `orca chat read` and `orca chat send` let an agent read and message other chats ([#2](https://github.com/dluxhu/orca/pull/2)).
- **Mention chats and terminals.** Type `@` in a chat to mention another chat or terminal of the same host ([#10](https://github.com/dluxhu/orca/pull/10)).
- **Mention chats on other hosts.** The `@` menu also lists the chats and terminals of the host's saved environments, and the agent gets the `--environment` to reach them ([#29](https://github.com/dluxhu/orca/pull/29)).
- **Open a mentioned chat.** In a sent message, a click on a mention chip opens that chat or terminal ([#42](https://github.com/dluxhu/orca/pull/42)).
- **Quote chips.** "Add to chat" quotes show as chips; type a comment right after each chip, on its line; a click jumps back to the quoted text and highlights it ([#12](https://github.com/dluxhu/orca/pull/12)).
- **Shorter long quotes.** A long quote of a recent reply in the same chat goes to the agent shortened, since the agent has that reply already; the chat still shows the full quote ([#31](https://github.com/dluxhu/orca/pull/31)).
- **Back to the quote.** After a quote chip jumps to its source, Back returns to the quote and Forward goes to the source again ([#26](https://github.com/dluxhu/orca/pull/26)).
- **Send with Cmd+Enter.** An option in Settings > Chat > Behavior: Enter adds a new line, and Cmd+Enter (Ctrl+Enter off macOS) sends ([#23](https://github.com/dluxhu/orca/pull/23)).
- **Show raw.** A "Show raw" button in a chat's title bar opens a panel with the exact messages sent to the agent and what comes back. A {} button under each reply opens the panel at that reply's entries and highlights them ([#33](https://github.com/dluxhu/orca/pull/33)).
- **Plain bare #numbers in chat.** A project setting, "Link bare #numbers in chat" (on by default). Turn it off, and a bare `#123` or `PR #123` in a chat stays text; `owner/repo#123` still links ([#39](https://github.com/dluxhu/orca/pull/39)).
- **Automatic compaction divider.** When Claude Code compacts its context on its own, the chat shows a "Context compacted automatically" divider, also after the chat is read again from the Claude transcript ([#40](https://github.com/dluxhu/orca/pull/40)).
- **Sender names across Orcas.** Mail from a chat on another Orca shows that chat's name to the agent, and a click on the "Message from" card opens the chat on its Orca ([#41](https://github.com/dluxhu/orca/pull/41)).
- **Stable and Nightly.** The release channel switcher lists Stable and Nightly. Nightly is a separate app that updates itself to newer Nightly builds; the stable app never takes a Nightly build ([#38](https://github.com/dluxhu/orca/pull/38)).

Fixes:

- A chat that is refused before it starts names the reason, not an unknown outcome ([#14](https://github.com/dluxhu/orca/pull/14)).
- A chat adopts a Claude conversation that moved into its workspace after it started elsewhere ([#17](https://github.com/dluxhu/orca/pull/17)).
- The macOS `orca` command starts the app even when its executable is not named "Orca" ([#18](https://github.com/dluxhu/orca/pull/18)).
- Register says when it replaces the `orca` command link of another Orca app ([#19](https://github.com/dluxhu/orca/pull/19)).
- `orca computer` works: the macOS Computer Use helper trusts the Orca @dLux apps (stable, Nightly and profile apps).

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) has the release order and the upstream state of each patch.

## How the fork is kept

`main` is a copy of upstream. Each patch is its own branch on the newest upstream stable release. When a release is
necessary, it squash-merges the patch branches onto the newest upstream stable release, with no wait.
`release/latest` shows the newest release. Open pull requests against `upstream-stable`.

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) lists every patch and the release steps.

## License

MIT, the same as upstream Orca. See [LICENSE](../LICENSE).
