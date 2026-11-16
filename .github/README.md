# Orca @dLux

Orca @dLux is a fork of [Orca](https://github.com/stablyai/orca), the IDE for parallel
agentic development. It installs beside official Orca, and it shares the official Orca
profile. Use one of the two apps at a time.

## Download

Get the app from the [releases](https://github.com/dluxhu/orca/releases). The app updates
itself from the same releases.

The app is not signed with an Apple Developer ID and Apple did not notarize it. macOS blocks
the first start. To open it: in Finder, Control-click the app, select **Open**, then select
**Open** again.

## How it is different from official Orca

|                              | Official Orca            | Orca @dLux                                                                       |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| App name                     | Orca                     | Orca @dLux                                                                       |
| Bundle id                    | `com.stablyai.orca`      | `com.stablyai.orca.dlux`                                                         |
| Updates from                 | `stablyai/orca` releases | `dluxhu/orca` releases                                                           |
| Settings, sign-ins, projects | its profile              | the same profile and the same Keychain key                                       |
| `orca` command               | registers `orca`         | registers `orca` too, and tells you when it takes the link from the other app    |
| Chat CLI                     |                          | `orca chat list`, `orca chat read`, `orca chat send`                             |
| Claude Remote Control        |                          | turn it on and off in a Claude chat tab; prompts from claude.ai show in the chat |

On the first start, macOS asks if Orca @dLux can use the "orca Safe Storage" Keychain item.
Select **Always Allow**. Then your stored sign-ins work in both apps.

## How the fork is kept

`main` is a copy of upstream. Each patch is its own branch on the newest upstream stable release. Once a week at most, a
release squash-merges the patch branches onto the newest upstream stable release.
`release/latest` shows the newest release. Open pull requests against `upstream-stable`.

[docs/fork/PATCHES.md](../docs/fork/PATCHES.md) lists every patch and the release steps.

## License

MIT, the same as upstream Orca. See [LICENSE](../LICENSE).
