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
- **Show raw.** A "Show raw" button in a chat's title bar opens a panel with the exact messages sent to the agent and what comes back. A {} button under each reply opens the panel at that reply's entries and highlights them; a second click closes it ([#33](https://github.com/dluxhu/orca/pull/33)).
- **Plain bare #numbers in chat.** A project setting, "Link bare #numbers in chat" (on by default). Turn it off, and a bare `#123` or `PR #123` in a chat stays text; `owner/repo#123` still links ([#39](https://github.com/dluxhu/orca/pull/39)).
- **Automatic compaction divider.** When Claude Code compacts its context on its own, the chat shows a "Context compacted automatically" divider, also after the chat is read again from the Claude transcript ([#40](https://github.com/dluxhu/orca/pull/40)).
- **Sender names across Orcas.** Mail from a chat on another Orca shows that chat's name to the agent, and a click on the "Message from" card opens the chat on its Orca ([#41](https://github.com/dluxhu/orca/pull/41)).
- **Time passed in the usage format.** The status bar usage format (Settings > Appearance > Usage format) has `{5h.passed}`, the share of the window already passed, and `{5h.total}`, the window length, also for `7d`, `fable` and `30d`. For example, `{5h} of {5h.passed} {5h.reset}` shows "45% of 60% 2h" ([#55](https://github.com/dluxhu/orca/pull/55)).
- **Stable and Nightly.** The release channel switcher lists Stable and Nightly. Nightly is a separate app that updates itself to newer Nightly builds; the stable app never takes a Nightly build ([#38](https://github.com/dluxhu/orca/pull/38)).
- **App profiles.** `orca profiles create <name>` makes a separate app with its own data, sign-ins, `~/.orca` and agent folders, beside the default app ([#43](https://github.com/dluxhu/orca/pull/43)).
- **Profile Manager.** An app inside Orca (Profiles > Profile Manager...) lists, opens, makes, edits and removes profiles. You set the id; a profile removed with "Keep data" gets its data back when you make it again with the same id. A rename in Finder keeps the profile. Start at login is in Settings > General and on each Manager row; it changes only the login item, and a running app or server keeps running. A row whose app does not run has "Start background service" or "Stop background service". Open it with Profiles > Profile Manager... or Shift+Cmd+P. The plain app is "Default" ([#46](https://github.com/dluxhu/orca/pull/46), [#47](https://github.com/dluxhu/orca/pull/47)).
- **Profile icons.** Each profile app gets an icon with a badge: a character, an image or your own icon file. By default, the character is the first letter of the profile name (without "Orca"), in a colour from the name; a profile made before profile icons gets it at its next start. The menu bar of a profile app shows a black-and-white version of its icon next to the Orca glyph. There are 14 badge styles, and the style picker opens at once with ready-made previews. The character can have a colour: one of 6 swatches or your own (`--icon-color`). Pick it in the Profile Manager or with `orca profiles set-icon`. An icon change or a rename keeps the code signature, so macOS does not ask about the Keychain again ([#45](https://github.com/dluxhu/orca/pull/45), [#48](https://github.com/dluxhu/orca/pull/48), [#50](https://github.com/dluxhu/orca/pull/50)).

Fixes:

- A chat that is refused before it starts names the reason, not an unknown outcome ([#14](https://github.com/dluxhu/orca/pull/14)).
- A chat adopts a Claude conversation that moved into its workspace after it started elsewhere ([#17](https://github.com/dluxhu/orca/pull/17)).
- The macOS `orca` command starts the app even when its executable is not named "Orca" ([#18](https://github.com/dluxhu/orca/pull/18)).
- Register says when it replaces the `orca` command link of another Orca app ([#19](https://github.com/dluxhu/orca/pull/19)).
- In a paired server's chat, a bot on this computer picked with `@` shows as a chip, not as raw text ([#54](https://github.com/dluxhu/orca/pull/54)).
- `orca computer` works: the macOS Computer Use helper trusts the Orca @dLux apps (stable, Nightly and profile apps).

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) has the release order and the upstream state of each patch.

## How the fork is kept

`main` is a copy of upstream. Each patch is its own branch on the newest upstream stable release. When a release is
necessary, it squash-merges the patch branches onto the newest upstream stable release, with no wait.
`release/latest` shows the newest release. Open pull requests against `upstream-stable`.

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) lists every patch and the release steps.

## License

MIT, the same as upstream Orca. See [LICENSE](../LICENSE).
