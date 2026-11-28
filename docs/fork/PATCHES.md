# Orca @dLux patches

The "Orca @dLux" fork carries a small set of patches on top of upstream
[stablyai/orca](https://github.com/stablyai/orca). This file lists them, and the release
script reads its "Release order" list.

## Maintenance model

- `upstream-stable` points at the newest upstream stable tag (`vX.Y.Z`, not a prerelease).
  Patch branches are based on it, and fork PRs target it.
- `main` mirrors upstream `main`. It only fast-forwards; it has no fork commits. A patch
  moves to a branch on `main` only when it is submitted to or approved by upstream.
- Each patch is its own branch. Nothing merges in the fork. Patch branches stay open.
- Upstream candidates come first in the release order. Fork-only patches come after them.
- Use normal commits. Do not amend or force-push. To update a branch, merge the new stable
  tag into it.
- Only `dlux/fork-setup` changes this file. Other branches keep their notes in their PR.
- A release is cut from the newest upstream stable tag whenever a release is necessary. There
  is no weekly limit and no wait for a newer tag. The version is `<upstream version>-dlux.<N>`.
- Turn on `git rerere` (`git config rerere.enabled true`), so a resolved conflict is reused
  in the next merge and in the release build.

## Release order

The release build adds these branches onto the upstream stable tag, in this order.

1. `dlux/chat-cli` - upstream candidate: `orca chat list/read/send`.
2. `dlux/launch-refusal-cause` - upstream candidate: a chat create refused before attach reports its reason, not an unknown outcome (#13).
3. `dlux/claude-adopt-cwd` - upstream candidate: adopt a Claude conversation that ran in the workspace after it started elsewhere (#13).
4. `dlux/cli-wrapper-exec` - upstream candidate: the macOS `orca` launcher starts the executable that `Info.plist` names.
5. `dlux/cli-link-notice` - upstream candidate: Settings > Command line says when Register replaces the `orca` link of another `.app`.
6. `dlux/remote-control` - upstream candidate: Claude Code chat mode: Remote Control in chat tabs, `orca agent launch --resume <session-id>` and `--remote-control` (#4). Stacked on `dlux/launch-refusal-cause`.
7. `dlux/session-mention` - upstream candidate: `@` lists other chats and terminals (#7). Its note tells the agent to use `orca chat send/read`, so it comes after `dlux/chat-cli`.
8. `dlux/session-mention-hosts` - upstream candidate: `@` also lists the chats and terminals of the host's saved environments, and the note names `--environment` (#25). Stacked on `dlux/session-mention`.
9. `dlux/session-mention-links` - upstream candidate: a mention chip in a sent message opens the mentioned chat or terminal (fork PR #42). Stacked on `dlux/session-mention-hosts`.
10. `dlux/glue-mention-quote` - glue: the resolution of `dlux/session-mention` and `dlux/quote-chip`, which change the same lines (see "Glue branches"). It contains `dlux/session-mention-links`. Right before `dlux/quote-chip`.
11. `dlux/quote-chip` - upstream candidate: "Add to chat" quotes show as chips, with a comment after each chip on its line (#5, #27).
12. `dlux/quote-short-send` - upstream candidate: a long quote of a recent reply in the same chat goes to the agent shortened; the chat still shows it in full (#28). Stacked on `dlux/quote-chip`.
13. `dlux/quote-jump-history` - upstream candidate: a quote chip jump joins Back and Forward (#24). Stacked on `dlux/quote-chip`.
14. `dlux/item-chat-chips` - upstream candidate: in a bot item's Activity, the owner's comments show quotes and chat or terminal mentions as chat's chips; a quote chip shows its words in the Activity, a mention chip opens the session on the bot's host (fork PR #58). Stacked on `dlux/glue-mention-quote`, the only branch with both the quote and the mention chips.
15. `dlux/chat-send-key` - upstream candidate: an option to send with Cmd/Ctrl+Enter, so Enter adds a new line (#22). Stacked on `dlux/session-mention`: both change the composer keydown hook.
16. `dlux/chat-raw-view` - upstream candidate: a "Show raw" panel in a chat lists the exact messages sent to the agent and what comes back; a {} button under each reply opens it at that reply's entries, and a second click on it closes the panel (#32).
17. `dlux/chat-bare-refs-plain` - upstream candidate: a project setting "Link bare #numbers in chat"; when it is off, a bare `#123` in a chat stays text, and `owner/repo#123` still links (fork PR #39).
18. `dlux/chat-compaction-marker` - upstream candidate: a chat shows a "Context compacted automatically" divider when Claude Code compacts its context on its own, also in a chat read from the Claude transcript (fork PR #40).
19. `dlux/peer-mail-sender-name` - upstream candidate: mail from a chat on another Orca names that chat in the From line, and its "Message from" card opens it on its Orca (fork PR #41).
20. `dlux/client-bot-mention-pill` - upstream candidate: in a paired server's chat, a pick of a bot on this computer gives a bot pill, not the raw token (fork PR #54, #53).
21. `dlux/usage-panel-format` - upstream candidate: the status bar usage format has `{5h.time%}` (share of the window passed, or left in Remaining mode) and `{5h.total}` (window length) for each window (fork PR #55).
22. `dlux/local-webhooks` - upstream candidate: local webhooks without an Orca account; a host takes webhook calls on its own port, turned on in Settings > Automations > Local webhooks (fork PR #57).
23. `dlux/fork-release-channel` - fork-only: the release channels Stable and Nightly; the Nightly app has its own update feed (fork PR #38).
24. `dlux/fork-setup` - fork-only: identity, shared profile, update feed, headless orcad fallback, this file. Stacked on `dlux/cli-wrapper-exec` and `dlux/cli-link-notice`. Last, except the branches stacked on it.
25. `dlux/profiles` - fork-only: app profiles, each a separate app with its own data, `~/.orca` and agent folders (fork PR #43). Stacked on `dlux/fork-setup`.
26. `dlux/profile-manager` - fork-only: the Profile Manager, `orca profiles` commands for user-set ids, kept data, rename, port and Start at login; saved ports (also the default app's `defaultPort`) that `orca serve` uses without `--port`; Settings > General "Port"; the runtime file names its owner (`role`) for the profile states (fork PR #46). Stacked on `dlux/profiles`.
27. `dlux/profile-manager-app` - fork-only: the Profile Manager is an app inside the Orca app (fork PR #47). Stacked on `dlux/profile-manager`.
28. `dlux/profile-manager-icons` - fork-only: icons in the Profile Manager (fork PR #48). Stacked on `dlux/profile-manager-app`. It merges `dlux/profile-icons` and `dlux/profile-icons-sticker` and holds the resolution of the branches, as a glue branch does. Right before `dlux/profile-icons`.
29. `dlux/profile-icons` - fork-only: profile icons and badges (fork PR #45). Stacked on `dlux/profiles`. It adds nothing after `dlux/profile-manager-icons`, and the release skips it.
30. `dlux/profile-icons-sticker` - fork-only: the `sticker` badge style; its golden test has its own limit (design section 8, "`sticker` has its own limit") (fork PR #50). Stacked on `dlux/profile-icons`. Right after `dlux/profile-icons`. It adds nothing after `dlux/profile-manager-icons`, and the release skips it.
31. `dlux/icon-selector` - fork-only: one icon chooser for Settings > Appearance > App icon and the Profile Manager: a base icon (the three built-in icons or an upload) and an optional badge; `set-icon default` for the default app's own icon (fork PR #59). Stacked on `dlux/profile-manager-icons`. Right after `dlux/profile-icons-sticker`.

| Branch                         | Base                                                                  | Kind               | Upstream PR                                                                                                                                                                                                      | Files                                                 | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dlux/chat-cli`                | `upstream-stable`                                                     | upstream candidate | not offered: upstream issue [#40664](https://github.com/stablyai/orca/issues/40664) has open PRs [#43057](https://github.com/stablyai/orca/pull/43057) and [#41850](https://github.com/stablyai/orca/pull/41850) | see "Branch dlux/chat-cli"                            | `pnpm exec vitest run --config config/vitest.config.ts src/cli/agents/chat.test.ts src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-gate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dlux/launch-refusal-cause`    | `upstream-stable`                                                     | upstream candidate | planned, together with `dlux/remote-control` (only its resume reaches this refusal)                                                                                                                              | fork PR [#14](https://github.com/dluxhu/orca/pull/14) | `pnpm exec vitest run --config config/vitest.config.ts src/main/agent-launch/agent-launch-create-refusal.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-create-refusal.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-surfaces-refusal.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dlux/claude-adopt-cwd`        | `upstream-stable`                                                     | upstream candidate | not offered: upstream fixed the main case in [#43325](https://github.com/stablyai/orca/pull/43325)                                                                                                               | fork PR [#17](https://github.com/dluxhu/orca/pull/17) | `pnpm exec vitest run --config config/vitest.config.ts src/main/native-chat/agent-session-journal/history-import/adopted-transcript-source.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dlux/cli-wrapper-exec`        | `upstream-stable`                                                     | upstream candidate | not offered: the same fix is in open upstream PR [#35382](https://github.com/stablyai/orca/pull/35382)                                                                                                           | fork PR [#18](https://github.com/dluxhu/orca/pull/18) | `pnpm exec vitest run --config config/vitest.config.ts src/main/cli/packaged-assets/packaged-cli-assets.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dlux/cli-link-notice`         | `upstream-stable`                                                     | upstream candidate | issue [#43460](https://github.com/stablyai/orca/issues/43460); PR [#43876](https://github.com/stablyai/orca/pull/43876) (async realpath for upstream lint)                                                       | fork PR [#19](https://github.com/dluxhu/orca/pull/19) | `pnpm exec vitest run --config config/vitest.config.ts src/main/cli/installation/cli-installer-other-app-notice.test.ts src/renderer/src/components/settings/cli/install/use-cli-registration-actions.test.ts src/renderer/src/lib/cli/cli-user-facing-detail.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dlux/remote-control`          | `dlux/launch-refusal-cause`                                           | upstream candidate | planned; links upstream issues [#37502](https://github.com/stablyai/orca/issues/37502) and [#37143](https://github.com/stablyai/orca/issues/37143)                                                               | fork PR [#3](https://github.com/dluxhu/orca/pull/3)   | `pnpm exec vitest run --config config/vitest.config.ts src/main/claude/structured/claude-structured-remote-control.test.ts src/main/native-chat/agent-session-wire/providers/structured-agent-session-adapter-router-remote-control.test.ts src/main/agent-launch/agent-launch-resume.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-surfaces-resume.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-resume-unknown-cause.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-surfaces-remote-control.test.ts src/shared/rpc-contract/agent-launch/agent-launch-params.test.ts src/cli/agents/agent-launch-request.test.ts src/cli/index-agent-launch.test.ts` |
| `dlux/session-mention`         | `upstream-stable`                                                     | upstream candidate | issue [#43462](https://github.com/stablyai/orca/issues/43462); planned                                                                                                                                           | fork PR [#10](https://github.com/dluxhu/orca/pull/10) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/composer src/shared/orchestration/mailbox`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dlux/session-mention-hosts`   | `dlux/session-mention`                                                | upstream candidate | —                                                                                                                                                                                                                | fork PR [#29](https://github.com/dluxhu/orca/pull/29) | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/rpc/methods/native-chat/native-chat-mention-sessions.test.ts src/renderer/src/components/native-chat/composer src/shared/orchestration/mailbox`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dlux/session-mention-links`   | `dlux/session-mention-hosts`                                          | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#42](https://github.com/dluxhu/orca/pull/42) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/messages/rows/NativeChatUserMessageRow.mentions.test.tsx src/shared/orchestration/mailbox`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dlux/glue-mention-quote`      | `dlux/session-mention-links` + `dlux/quote-chip`                      | glue               | none                                                                                                                                                                                                             | see "Glue branches"                                   | the checks of both branches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dlux/quote-chip`              | `upstream-stable`                                                     | upstream candidate | issue [#43461](https://github.com/stablyai/orca/issues/43461); planned                                                                                                                                           | fork PR [#12](https://github.com/dluxhu/orca/pull/12) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/composer/editor src/renderer/src/components/native-chat/selection-quotes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dlux/quote-short-send`        | `dlux/quote-chip`                                                     | upstream candidate | —                                                                                                                                                                                                                | fork PR [#31](https://github.com/dluxhu/orca/pull/31) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/composer/submit src/renderer/src/components/native-chat/selection-quotes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dlux/quote-jump-history`      | `dlux/quote-chip`                                                     | upstream candidate | planned, with `dlux/quote-chip`                                                                                                                                                                                  | fork PR [#26](https://github.com/dluxhu/orca/pull/26) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/selection-quotes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dlux/item-chat-chips`         | `dlux/glue-mention-quote`                                             | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#58](https://github.com/dluxhu/orca/pull/58) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/bots/items/BotItemCommentChips.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dlux/chat-send-key`           | `dlux/session-mention`                                                | upstream candidate | planned, after `dlux/quote-chip`                                                                                                                                                                                 | fork PR [#23](https://github.com/dluxhu/orca/pull/23) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/composer src/renderer/src/components/settings/chat`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dlux/chat-raw-view`           | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#33](https://github.com/dluxhu/orca/pull/33) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/messages/diagnostics/NativeChatRawPanel.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `dlux/chat-bare-refs-plain`    | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#39](https://github.com/dluxhu/orca/pull/39) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/markdown/NativeChatMarkdown.github-refs.test.tsx src/renderer/src/components/settings/repository/source-control/RepositoryChatReferenceLinksSection.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dlux/chat-compaction-marker`  | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#40](https://github.com/dluxhu/orca/pull/40) | `pnpm exec vitest run --config config/vitest.config.ts src/main/claude/structured/journal/claude-compaction-row.test.ts src/main/native-chat/transcript-decoding/transcript-line-decoders-claude-compaction.test.ts src/renderer/src/components/native-chat/messages/notices/NativeChatNoticeRow.compaction.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                    |
| `dlux/peer-mail-sender-name`   | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#41](https://github.com/dluxhu/orca/pull/41) | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/rpc/methods/orchestration/federation/peer-mail.test.ts src/main/runtime/orchestration/mailbox/formatting/message-formatting.test.ts src/renderer/src/components/native-chat/NativeChatAgentMessageCard.peer-sender.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `dlux/client-bot-mention-pill` | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#54](https://github.com/dluxhu/orca/pull/54) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document-text.test.ts src/renderer/src/components/bots/use-bot-mention-targets.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dlux/usage-panel-format`      | `upstream-stable`                                                     | upstream candidate | not submitted                                                                                                                                                                                                    | fork PR [#55](https://github.com/dluxhu/orca/pull/55) | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/status-bar/usage/usage-format-template.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dlux/local-webhooks`          | `upstream-stable`                                                     | upstream candidate | [#51429](https://github.com/stablyai/orca/pull/51429) (part 1 of 2; part 2, the settings, is on `dluxhu:feat/local-webhooks-settings`, not opened yet)                                                           | fork PR [#57](https://github.com/dluxhu/orca/pull/57) | `pnpm exec vitest run --config config/vitest.config.ts src/main/webhooks/local`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dlux/fork-release-channel`    | `upstream-stable`                                                     | fork-only          | none                                                                                                                                                                                                             | fork PR [#38](https://github.com/dluxhu/orca/pull/38) | `pnpm exec vitest run --config config/vitest.config.ts src/shared/updater/release-channel-fork.test.ts src/main/updater/releases/updater-prerelease-feed-fork.test.ts src/main/updater/releases/updater-release-builds-fork.test.ts` and `config/scripts/fork/publish-nightly-feed.test.sh`                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dlux/fork-setup`              | `upstream-stable` (+ `dlux/cli-wrapper-exec`, `dlux/cli-link-notice`) | fork-only          | none                                                                                                                                                                                                             | see "Branch dlux/fork-setup: Files"                   | see "Branch dlux/fork-setup: Check"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dlux/profiles`                | `dlux/fork-setup`                                                     | fork-only          | none                                                                                                                                                                                                             | fork PR [#43](https://github.com/dluxhu/orca/pull/43) | see "Branch dlux/profiles"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dlux/profile-manager`         | `dlux/profiles`                                                       | fork-only          | none                                                                                                                                                                                                             | fork PR [#46](https://github.com/dluxhu/orca/pull/46) | `pnpm exec vitest run --config config/vitest.config.ts src/cli/app-profiles src/main/app-profiles src/shared/app-profiles src/main/menu/register-app-menu-profiles.test.ts src/renderer/src/components/profile-manager src/renderer/src/components/settings/general/StartAtLoginSetting.test.tsx src/cli/server/serve-service.test.ts src/cli/runtime/commands/cli-lifecycle-handlers.test.ts src/main/runtime/rpc/server/runtime-rpc-metadata-role.test.ts src/main/orcad/host-runtime/orcad-runtime-rpc.test.ts`                                                                                                                                                                                       |
| `dlux/profile-manager-app`     | `dlux/profile-manager`                                                | fork-only          | none                                                                                                                                                                                                             | fork PR [#47](https://github.com/dluxhu/orca/pull/47) | `pnpm exec vitest run --config config/vitest.config.ts config/scripts/desktop-distribution/macos/macos-profile-manager-app.test.mjs src/cli/app-profiles src/main/app-profiles src/main/updater/mac-install/macos-update-running-instances.test.ts src/renderer/src/components/profile-manager src/cli/runtime/commands/cli-lifecycle-handlers.test.ts src/main/runtime/rpc/server/runtime-rpc-metadata-role.test.ts src/main/orcad/host-runtime/orcad-runtime-rpc.test.ts src/shared/app-profiles src/renderer/src/components/settings/general`                                                                                                                                                         |
| `dlux/profile-manager-icons`   | `dlux/profile-manager-app` + `dlux/profile-icons-sticker`             | fork-only          | none                                                                                                                                                                                                             | fork PR [#48](https://github.com/dluxhu/orca/pull/48) | `pnpm exec vitest run --config config/vitest.config.ts src/cli/app-profiles src/main/app-profiles src/shared/icon-badger src/renderer/src/components/profile-manager src/cli/runtime/commands/cli-lifecycle-handlers.test.ts src/main/runtime/rpc/server/runtime-rpc-metadata-role.test.ts src/main/orcad/host-runtime/orcad-runtime-rpc.test.ts src/shared/app-profiles src/renderer/src/components/settings/general`                                                                                                                                                                                                                                                                                   |
| `dlux/profile-icons`           | `dlux/profiles`                                                       | fork-only          | none                                                                                                                                                                                                             | fork PR [#45](https://github.com/dluxhu/orca/pull/45) | `pnpm exec vitest run --config config/vitest.config.ts src/cli/app-profiles src/shared/icon-badger src/main/app-profiles/app-profile-dock-icon.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dlux/profile-icons-sticker`   | `dlux/profile-icons`                                                  | fork-only          | none                                                                                                                                                                                                             | fork PR [#50](https://github.com/dluxhu/orca/pull/50) | `pnpm exec vitest run --config config/vitest.config.ts src/shared/icon-badger`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dlux/icon-selector`           | `dlux/profile-manager-icons`                                          | fork-only          | none                                                                                                                                                                                                             | fork PR [#59](https://github.com/dluxhu/orca/pull/59) | `pnpm exec vitest run --config config/vitest.config.ts src/cli/app-profiles src/main/app-profiles src/renderer/src/components/profile-manager src/renderer/src/components/settings/appearance src/shared/app-profiles src/main/window/desktop-integration/app-icon.fork.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                         |

To add a branch: base it on `upstream-stable`, add it to the numbered list above (upstream candidates
before fork-only ones), add a row, and add a "Branch" section below. Add one line for it to the
"Patches" list in `.github/README.md`. When its upstream state changes, update its "Upstream PR" cell.

## Steps for a new upstream stable tag

Do these steps when upstream publishes a new stable tag. Do not wait for a newer tag.

1. Fast-forward `main` to upstream (for upstream submissions):
   `git fetch upstream --tags && git checkout main && git merge --ff-only upstream/main && git push origin main`.
2. Move `upstream-stable` to the newest stable tag:
   `git branch -f upstream-stable <tag> && git push --force-with-lease origin upstream-stable`.
3. Merge the new tag into every branch. The scripts are in `config/scripts/fork/release-tools/`; run
   them from any worktree of the fork, with each branch checked out in a worktree of its own:

   ```sh
   R=config/scripts/fork/release
   $R/heads.sh <old tag>                        # every branch: local == origin, has the old tag
   $R/own-diff.sh save <old tag> <dir>/before   # each branch's own diff, before the merges
   $R/merge-all.sh <new tag> <old tag> --plan   # the merges, in order; changes nothing
   $R/merge-all.sh <new tag> <old tag>          # stops at a conflict: fix, commit, --from <branch>
   $R/own-diff.sh save <new tag> <dir>/after    # after pushing; reads origin/dlux/*
   $R/own-diff.sh compare <dir>/before <dir>/after
   ```

   A branch on `upstream-stable` merges the new tag with the old tag as merge base. Each stable
   tag is on its own upstream release branch, and git's own base would re-apply the old tag's
   stable-only commits. So a file that only those commits changed takes the version of the new
   tag. A stacked branch merges its updated base branches (the "Base" cell of its row). Resolve
   the conflicts with the branch's "Re-apply" notes, run its check, and push it (a plain push).
   `compare` prints SAME for a branch whose own change did not move; look at every DIFF.

4. Build one release on that tag (below). Publish it only on the owner's go-ahead.

## Release steps

The scripts are in `config/scripts/fork/release-tools/` (with `config/scripts/fork/build-release.sh`).
Each one prints its usage when it is called without arguments. The heavy ones (`checks.sh`,
`build-app.sh`) take minutes and a lot of memory: run each as one job. `NODE_BIN_DIR=<Node 24
bin folder>` puts that Node first in `PATH`.

1. Start from a clean tree, with the stable tag merged into every branch, and every branch
   pushed. `heads.sh <tag>` shows each branch's origin and local head, whether it has the tag,
   and its worktree. Turn off git's background repack in the main clone while the release runs
   (`git config maintenance.auto false; git config gc.auto 0`; unset both after): a repack
   during `build-release.sh` gave "packfile index unavailable" errors.
2. The combined check tree: `combine.sh <tag> <check worktree>` detaches that worktree at the
   tag and merges every branch of "Release order" into it. Then
   `checks.sh <check worktree> <tag> <log dir>`: install, the targeted tests (the fork diff's
   test files and the "Check" column paths), the `.mjs` tests, oxlint and oxfmt of the fork
   diff, the node, web and cli typecheck, the two localization checks,
   `test:repro:skills-cli-runtime` and the fork's `*.test.sh`. It prints `result: PASS`.
   To check only some steps again after a fix: `checks.sh <wt> <tag> <dir> vitest tc`, and
   `TESTS="<paths>"` for the failed test files. Fix on the owning branch, merge forward to the
   branches stacked on it (and the glue branches), push, and combine again.
   - Run the checks on the combined tree, not only per branch: a new tag can remove an
     upstream API that a patch uses, and two patches can meet in one test (each branch passes
     alone).
   - A runtime string with `{{...}}` must also be in `src/renderer/src/i18n/en-runtime-required.json`,
     or `verify:localization-runtime-catalog` fails.
3. Run `config/scripts/fork/build-release.sh --remote origin`. Options: `--base <tag>` picks
   a stable tag, `--version <version>` sets the version, `--upstream <name>` names the
   upstream remote.
   - The base is the newest upstream stable tag (`vX.Y.Z`). The script refuses a base that is
     not a stable tag.
   - The version is `<base version>-dlux.<N>`, for example `1.4.259-dlux.1`. N goes up by
     one when the same base is built again.
   - It makes `release/<version>` from the base in a new worktree and adds each branch of
     "Release order" as one commit: the branch's diff from the stable commit it is based on,
     by a 3-way cherry-pick. A stacked branch adds only its own change: its diff from the part
     of each earlier branch of the order that it contains (all merge bases with each earlier
     tip, merged with merge-tree). Then it tags `v<version>` and moves the local
     `release/latest` branch to the tag. It prints the push commands. It never pushes.
   - It refuses a dirty tree and an identity that is not a GitHub noreply address.
   - It warns when a branch does not contain the base tag: merge the tag into the branch.
   - On a conflict it stops with the branch, the files and the clean-up commands. Merge the
     tag into the branch and resolve there, or fix the files in the release worktree and run
     `git rerere` to record the fix. Clean up, and run the script again: rerere replays the fix.
   - The release tree must be the checked tree: `git diff --quiet <combined HEAD> release/<version>`.
     `build-release.sh` reads `origin/` refs and `combine.sh` local ones, so push first.
     A fix after the checks means: remove the local tag, branch and worktree, move the local
     `release/latest` back, and run it again.
4. Build and check the app in the release worktree, on an Apple Silicon Mac with Node 24, pnpm
   and a Developer ID certificate in the login keychain:

   ```sh
   gh release download v<base> -R stablyai/orca -p 'Orca-<base>-arm64-mac.zip' -D <dir>
   LAST_RELEASE_ZIP=<last fork release zip> LAST_RELEASE_COMMIT=<its commit> \
     config/scripts/fork/release-tools/build-app.sh <release worktree> <version> <dir>/Orca-<base>-arm64-mac.zip
   ```

   It prints `result: PASS` after these steps:
   - The Swift helpers. A helper whose sources are the same as in the last fork release is
     taken from that app (upstream's helpers have no fork identity); else it is built. The
     Computer Use and socket-owner helpers are always built.
   - `pnpm install` (also in `mobile/`: `build:desktop` builds the phone page),
     `build:desktop`, `ensure:electron-runtime`, the orcad template: common files and
     darwin-arm64 from this worktree, the other targets' native slots grafted from upstream's
     app of the same version (`graft-orcad-template-targets.mjs`), then
     `ORCA_REQUIRE_ORCAD_TEMPLATE=1 ORCA_LOCAL_BUILD_VERSION=<version> electron-builder --mac zip dmg --arm64`.
   - The checks: version, orcad template, the nested Profile Manager app (bundle id, name,
     role, no `orca:` claim, a real framework folder, links that stay in the outer app),
     `codesign --verify --deep --strict` of the app and `--verify` of the nested app.
   - The smoke tests, each with a clean environment, a temp home and a free port: `orca --help`,
     the CLI in the Manager app finds the outer app, `orca serve` is ready, local webhooks
     (`settings.update` over the runtime socket, then a POST without a key gives 401 and one to
     an unknown hook 404), and the Profile Manager page renders in a hidden window
     (`SKIP_PM_SMOKE=1` skips it).
   - Notes:
     - Upstream CI builds the native slots of each target on its own runner and merges them
       (`.github/workflows/node-server-tests.yml`, job `desktop_template`). One Mac cannot build
       them. The fork changes no native code, so it uses upstream's slots of the same version.
       The graft script copies only `targets/`, checks each file against upstream's manifest, and
       runs the template check for every target.
     - The nested Profile Manager app (from the `afterPack` hook) gets `--verify` without
       `--strict`: its links point out of the nested bundle.
     - The `ORCA_E2E_*` variables give serve a mock Keychain. Without them, a build with a new
       code signature waits for the "orca Safe Storage" Keychain prompt.
     - `--mac zip dmg` is necessary: the config lists x64 and arm64 for each target, so
       `--arm64` alone also starts an x64 package, and that fails on an arm64-only install.
     - The Computer Use helper has no hardened runtime after electron-builder signs it (a
       warning). Only notarization needs it.
     - The build stops before a step when the disk has less than 10 GiB free.

5. For a release that changes the profile apps (a new Electron, the loader, the profile
   create code): `NEW_APP=<release worktree>/dist/mac-arm64/<app> config/scripts/fork/release-tools/profile-e2e.sh dry`,
   then `run` when nobody uses the Mac (about 15 min, it starts the app). A profile made by the
   installed release gets the new build as its default app: the refresh must run, the app
   starts again by itself, and the menu bar shows the profile name. The script puts back what
   LaunchServices, launchd, the Keychain and the preferences got, and prints what changed in
   the real home folder (must be empty).
6. On the owner's go-ahead: `git push origin release/<version> v<version>`,
   `git push --force-with-lease=release/latest:<old sha> origin <new sha>:refs/heads/release/latest`
   (and `upstream-stable` the same way after a base move). Then make the GitHub release on
   `dluxhu/orca` from the tag, with the zip, the dmg, both blockmaps and `latest-mac.yml`, and
   the notes: what is new, the patch list (one line per fork PR), the known issues. Check that
   `/releases/latest/download/latest-mac.yml` serves the new version, and that the size and
   sha512 of the zip and the dmg match it.

## Glue branches

Two patch branches that are not stacked can change the same lines. The release then stops when
it applies the later one. A glue branch holds the resolution, so the release does not depend on
a local rerere cache:

- Make it from the first branch, merge the second branch into it, and commit the resolution.
- Put it in the release order right before the second branch. The release applies the second
  branch's change and the resolution together. The second branch then adds nothing and is
  skipped, and branches stacked on it apply only their own change.
- When either branch changes, merge both into the glue branch again.

`dlux/glue-mention-quote` is the glue of `dlux/session-mention` and `dlux/quote-chip`. Both
change the chat markdown extension (agent mentions, quote chips) and the user message row.
The glue contains the whole mention stack (`dlux/session-mention-hosts`, `dlux/session-mention-links`),
because those branches change the user message row test too. When one of them changes, merge
`dlux/session-mention-links` into the glue branch.

`dlux/profile-manager-icons` is also a glue branch: it merges `dlux/profile-icons` into
`dlux/profile-manager-app`. Both change the profile create code and the profile paths. When
`dlux/profile-icons` changes, merge it into `dlux/profile-manager-icons`.

## Default branch and front page

- `release/latest` is the default branch of `dluxhu/orca`, so the GitHub front page shows
  the shipped fork. Each release force-moves it. Nobody bases work on it.
- The front page text is `.github/README.md` (GitHub shows it before the root `README.md`).
  The root `README.md` stays upstream's, so the merge of a new stable tag never conflicts on it.
- `main` stays a clean copy of upstream, for upstream submissions. Fork pull requests target
  `upstream-stable` or a patch branch.

## Branch dlux/chat-cli

Upstream candidate. Its PR on the fork holds the description, the files and the re-apply
notes. Its check is in the table above.

## Branch dlux/remote-control

Upstream candidate: the Claude Code chat mode, one unit. It has Remote Control in chat tabs,
`orca agent launch --resume <session-id>` and `orca agent launch --remote-control`. The
last two parts were the branches `dlux/chat-resume` (fork PR #9) and
`dlux/chat-resume-remote-control` (fork PR #15). They are merged into this branch, and the
release order does not list them. The branch is stacked on `dlux/launch-refusal-cause`.
Its PR on the fork holds the description, the files and the re-apply notes. Its check is in
the table above.

## Branch dlux/chat-bare-refs-plain

Upstream candidate. Its PR on the fork holds the description and the files. Its check is in
the table above. Re-apply: keep the upstream change, then put back the
`linkBareReferencesInChat` field in each repo update path next to `issueSourcePreference`.

## Branch dlux/fork-release-channel

Fork-only. The release channel switcher (Option-click the "About" header in Settings > General)
lists Stable and Nightly. Nightly uses the `daily` channel id. Stable and Nightly are separate
apps, so a pick of the other channel downloads its dmg. The stable app never takes a nightly
build. The Nightly app reads the fixed prerelease `nightly`, and the update delay does not apply
to it. Its PR on the fork holds the description, the files and the re-apply notes.

Publish the feeds:

- Stable: the release steps above. The GitHub release has `latest-mac.yml`, and the stable app
  reads it.
- Nightly: publish the nightly prerelease without `latest-mac.yml` (see "Nightly releases" on
  `nightly/fork-setup`). Then run
  `config/scripts/fork/publish-nightly-feed.sh v<nightly version> --dry-run`, check the file, and
  run it again without `--dry-run`. The script writes `latest-mac.yml` from the published zip and
  uploads it to the `nightly` prerelease. It makes that prerelease the first time.
- A Nightly build older than this patch reads `/releases/latest`. Install the first Nightly with
  this patch by hand.

## Branch dlux/profiles

Fork-only. App profiles: each profile is a separate app with its own data, `~/.orca` and agent
folders (`docs/fork/profiles-design.md`). It uses the fork identity, so it is stacked on
`dlux/fork-setup` and comes after it in the release order. To update it, merge the new
`dlux/fork-setup` into it. Its PR on the fork holds the description, the files and the check.

## Branch dlux/fork-setup

Fork-only. It is the top patch and is always last in the release order.

### Part 1: fork identity, shared profile

**What.** The fork has its own app name and bundle id, so it installs beside official Orca.
It uses the same userData folder as official Orca (`orca`), so the two apps share all
config files and stored sign-ins. Only one of them runs at a time: Electron's
single-instance lock is on that folder.

**Why.** Owner decision: switching between the two apps must be easy. Config file formats
do not change.

**Single source.** `src/shared/fork-identity.ts` holds every fork value. The other files only
read `FORK_IDENTITY`.

| Identity point                                                                          | Official Orca               | Orca @dLux                                  | File                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name (bundle name, Finder)                                                      | `Orca`                      | `Orca @dLux`                                | `config/electron-builder.config.cjs`                                                                                                                                         |
| Bundle id / appId                                                                       | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `config/electron-builder.config.cjs`                                                                                                                                         |
| Local-build contract appId (ShipIt cache, launchd `AssociatedBundleIdentifiers`)        | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `src/shared/remote-runtime/orcad-distribution/local-build-compatibility-contract.json`, `src/shared/remote-runtime/orcad-distribution/local-build-compatibility-contract.ts` |
| Notification status helper bundle id (default)                                          | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `config/scripts/native-build/macos/build-notification-status-macos.mjs`                                                                                                      |
| Notification settings link                                                              | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `src/main/ipc/notifications/notification-system-settings-link.ts`                                                                                                            |
| Name after ready (app name, About panel, menu title, Quit item), Windows AppUserModelId | `Orca`, `com.stablyai.orca` | `Orca @dLux`, `com.stablyai.orca.dlux`      | `src/main/startup/profile-startup/dev-instance-identity.ts`                                                                                                                  |
| "About Orca" and "Hide Orca" menu items                                                 | `Orca`                      | `Orca @dLux`                                | `src/main/menu/register-app-menu.ts` (`withForkName` from `src/shared/fork-identity.ts`)                                                                                     |
| Window title, in-app titlebar name                                                      | `Orca`                      | `Orca @dLux`                                | `src/main/window/createMainWindow.ts`, `src/renderer/index.html`, `src/renderer/src/app-shell/chrome/TitlebarLeftControls.tsx`                                               |
| TCC prompt watch: responsible bundle ids                                                | official ids                | adds `com.stablyai.orca.dlux` and `.helper` | `src/main/macos-permissions/macos-tcc-prompt-watch.ts`                                                                                                                       |
| Computer Use helper: trusted agent apps                                                 | official ids                | adds `com.stablyai.orca.dlux` and `.dlux.*` | `native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/TrustedOrcaApplication.swift`                                                                                    |

**Keychain.** Electron takes the safeStorage Keychain item from the app name before
`ready`. A packaged build has no `productName` in its `package.json`, so that name is the
`package.json` `name`, `orca`. Official Orca uses the item service "orca Safe Storage",
account "orca Key". The fork keeps `name: orca` and does not rename itself before ready
(`shouldApplyPreReadyAppName` stays upstream), so it uses the same item and reads the
encrypted values in the shared profile. It sets the name `Orca @dLux` only after ready.
macOS asks once to let Orca @dLux use that item, because the code signatures differ. Click
"Always Allow". If no prompt appears on the first fork launch, the fork made a new key:
stop and do not save sign-ins in the fork.

**userData.** Electron takes the default userData folder from the same `name`:
`~/Library/Application Support/orca` on macOS. A packaged fork launch pins that default
folder as an explicit override (`configureDevUserDataPath` in
`src/main/startup/configure-process.ts`), unless `--user-data-dir` is given. The reason:
Electron recomputes the default userData from the app name, and the post-ready rename to
`Orca @dLux` would move it to a new folder. The app code does not call `setPath` after
ready, but Electron can recompute the path at any later `setPath`. On Windows,
`ensureWindowsAppDataPath` sets userData from `app.getName()` before any rename, which is
also `orca`, so the folder is the same as official Orca's. Windows is not tested on a real
machine yet.

**Known gap: Linux.** Linux is not tested. On a case-sensitive file system the paired-runtime
list may not be shared: official Orca can read `~/.config/Orca` after its own rename, while
the fork stays on `~/.config/orca`.

**Not changed on purpose.**

- The userData folder, the CLI runtime metadata and socket, the serve launchd labels, the
  logs folder and the offline hook paths: all stay official Orca's, because the profile is
  shared.
- The `orca://` URL scheme. Pairing codes, plugin links and skill links use `orca://`, and the
  parsers check for it. Both apps register it, and macOS opens the links in one of them.
- The `orca` command, on the user PATH and inside the app terminals. Both apps register
  `orca`; the last one to register owns the link. Settings > Command line says when
  Register replaces the link of the other app (branch `dlux/cli-link-notice`).
- Helper bundle ids (`com.stablyai.orca.computer-use`), dev-build names (`orca-dev`,
  `Orca Dev`) and the headless `orcad` paths.
- The press-and-hold check already accepts `com.stablyai.orca.*` ids.

**Re-apply.** On a conflict, keep the upstream change and put `FORK_IDENTITY.<field>` back in
place of the upstream literal. Never add `extraMetadata.name` or a pre-ready rename for
packaged builds: both change the Keychain item and the userData folder. To find
new bundle id literals that upstream added, run:

```sh
git grep -nE "com\.stablyai\.orca['\"]" -- src config native ':!*.test.*'
```

### Part 2: update feed

**What.** The auto-updater reads the releases of `dluxhu/orca` for every channel (stable, RC,
hourly, daily, adhoc). electron-builder publishes to `dluxhu/orca`.

**Why.** An upstream build has the upstream identity. It must never replace the fork.
Upstream data feeds (agent-state rules, WSL hosts policy) still read `stablyai/orca`
through `MAIN_RELEASE_REPO`.

**Files.**

- `src/shared/updater/release-channel.ts` (`APP_RELEASE_REPO`, the channel map, the release-notes link)
- `src/main/updater/lifecycle/updater-setup.ts`
- `src/main/updater/releases/updater-prerelease-feed.ts`
- `src/main/updater/releases/updater-release-readiness.ts`
- `config/electron-builder.config.cjs` (`publish`)
- `config/dev-app-update.yml`

**Re-apply.** Replace each new `github.com/stablyai/orca/releases` literal in updater code with
`APP_RELEASE_REPO`. Then update the test URLs:

```sh
git grep -lE "github.com/stablyai/orca/releases" -- 'src/main/updater/*' \
  | xargs sed -i '' 's#github.com/stablyai/orca/releases#github.com/dluxhu/orca/releases#g'
```

### Part 3: fork documents and release script

**What.** The fork front page `.github/README.md`, this file,
`config/scripts/fork/build-release.sh`, `config/scripts/fork/graft-orcad-template-targets.mjs`
and the release helpers in `config/scripts/fork/release-tools/` (see "Steps for a new upstream stable
tag" and "Release steps"). The graft script refuses an upstream app of another version and a
file that does not match upstream's manifest. Its test is
`config/scripts/fork/graft-orcad-template-targets.test.mjs`. The release helpers' test is
`config/scripts/fork/release-tools/release.test.sh` (the merge plan and `merge.sh`).

The phone page fence (`MOBILE_WEB_APP_BUNDLE_MAX_EAGER_BYTES` in
`config/scripts/build/mobile-web-app/verify-mobile-web-app-bundle.mjs`) has 32 KiB more for the
phone page code of the fork patches. Re-apply: keep upstream's new value and add `+ 32 * 1024`.

### Part 4: headless orcad Electron fallback

**What.** On macOS, `installedElectronCandidates` in
`src/main/orcad/browser-providers/orcad-browser-provider.ts` lists only the fork's bundle:
`/Applications/Orca @dLux.app/Contents/MacOS/Orca @dLux` and the same path in `~/Applications`.
The names come from `FORK_IDENTITY.productName`.

**Why.** Upstream lists `Orca.app/Contents/MacOS/Orca`. With both apps installed, the fork's
headless orcad then starts official Orca's Electron, which is another version. With only the
fork installed, it finds no Electron. The Windows and Linux paths stay upstream's.

**Re-apply.** Keep the darwin branch marked "Fork patch". The test is the
`installedElectronCandidates` case in `src/main/orcad/browser-providers/orcad-browser-provider.test.ts`.

### Test changes

`src/main/startup/fork-identity.test.ts` checks the fork values end to end. Upstream v1.4.272
deleted the upstream tests that this branch changed only for their expected fork literals.

### Check

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 src/main/startup src/main/cli src/main/menu src/main/macos-permissions src/main/updater src/shared src/main/local-builds src/main/daemon/executable-host config/scripts/fork src/main/orcad/browser-providers/orcad-browser-provider.test.ts src/cli/runtime/profile/metadata.fork.test.ts
swift test --package-path native/computer-use-macos --filter TrustedOrcaApplicationTests
config/scripts/fork/build-release.test.sh
config/scripts/fork/release-tools/release.test.sh
```

By hand, on macOS, with official Orca signed in first:

1. Quit official Orca. Start Orca @dLux. macOS asks to allow access to "orca Safe Storage":
   click "Always Allow". No prompt means a new key was made: stop.
2. A stored sign-in (for example a GitHub account) works in Orca @dLux.
3. Quit Orca @dLux. Start official Orca. The same sign-in still works.
4. The menu bar, About panel and window title say "Orca @dLux".

### Files

Source and config (24): `src/shared/fork-identity.ts` (new), `config/scripts/fork/build-release.sh` (new),
`config/scripts/fork/graft-orcad-template-targets.mjs` (new), `config/scripts/fork/release-tools/` (new),
`src/main/startup/configure-process.ts`, `config/electron-builder.config.cjs`,
`config/dev-app-update.yml`, `config/scripts/native-build/macos/build-notification-status-macos.mjs`,
`src/main/startup/profile-startup/dev-instance-identity.ts`, `src/main/menu/register-app-menu.ts`,
`src/main/window/createMainWindow.ts`, `src/renderer/index.html`,
`src/renderer/src/app-shell/chrome/TitlebarLeftControls.tsx`,
`src/main/macos-permissions/macos-tcc-prompt-watch.ts`,
`src/shared/remote-runtime/orcad-distribution/local-build-compatibility-contract.json`,
`src/shared/remote-runtime/orcad-distribution/local-build-compatibility-contract.ts`,
`src/main/ipc/notifications/notification-system-settings-link.ts`,
`src/shared/updater/release-channel.ts`, `src/main/updater/lifecycle/updater-setup.ts`,
`src/main/updater/releases/updater-prerelease-feed.ts`,
`src/main/updater/releases/updater-release-readiness.ts`,
`src/main/orcad/browser-providers/orcad-browser-provider.ts`, `.github/workflows/pr.yml`
(the package job reads the Linux `/opt` folder from `productName`),
`native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/TrustedOrcaApplication.swift`.

Tests (22): `src/main/startup/fork-identity.test.ts` (new),
`config/scripts/fork/release-tools/release.test.sh` (new),
`src/cli/runtime/profile/metadata.fork.test.ts` (new),
`native/computer-use-macos/Tests/OrcaComputerUseMacOSTests/TrustedOrcaApplicationTests.swift` (new),
`config/scripts/fork/graft-orcad-template-targets.test.mjs` (new),
`config/scripts/fork/build-release.test.sh` (new),
`src/main/startup/fork-identity-electron.test.ts` (new),
`src/main/orcad/browser-providers/orcad-browser-provider.test.ts` (Part 4) and the 14 files in
"Test changes".

The macOS CLI launcher and the CLI link notice are their own branches:
`dlux/cli-wrapper-exec` and `dlux/cli-link-notice`. This branch is stacked on both. It has no
change of its own in their files.

Documents (2): `.github/README.md` (new), `docs/fork/PATCHES.md` (new).
