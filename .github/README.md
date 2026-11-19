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
- **Quote chips.** "Add to chat" quotes show as chips; type a comment right after each chip, on its line; a click jumps back to the quoted text and highlights it ([#12](https://github.com/dluxhu/orca/pull/12)).
- **Shorter long quotes.** A long quote of a recent reply in the same chat goes to the agent shortened, since the agent has that reply already; the chat still shows the full quote ([#31](https://github.com/dluxhu/orca/pull/31)).
- **Back to the quote.** After a quote chip jumps to its source, Back returns to the quote and Forward goes to the source again ([#26](https://github.com/dluxhu/orca/pull/26)).
- **Send with Cmd+Enter.** An option in Settings > Chat > Behavior: Enter adds a new line, and Cmd+Enter (Ctrl+Enter off macOS) sends ([#23](https://github.com/dluxhu/orca/pull/23)).

Fixes:

- A chat that is refused before it starts names the reason, not an unknown outcome ([#14](https://github.com/dluxhu/orca/pull/14)).
- A chat adopts a Claude conversation that moved into its workspace after it started elsewhere ([#17](https://github.com/dluxhu/orca/pull/17)).
- The macOS `orca` command starts the app even when its executable is not named "Orca" ([#18](https://github.com/dluxhu/orca/pull/18)).
- Register says when it replaces the `orca` command link of another Orca app ([#19](https://github.com/dluxhu/orca/pull/19)).

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) has the release order and the upstream state of each patch.

## How the fork is kept

`main` is a copy of upstream. Each patch is its own branch on the newest upstream stable release. Once a week at most, a
release squash-merges the patch branches onto the newest upstream stable release.
`release/latest` shows the newest release. Open pull requests against `upstream-stable`.

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) lists every patch and the release steps.

## License

MIT, the same as upstream Orca. See [LICENSE](../LICENSE).
