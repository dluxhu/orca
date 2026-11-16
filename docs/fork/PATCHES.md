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
- A release is cut from the newest upstream stable tag, at most once a week. If upstream made
  several stable releases in the week, use only the newest. The version is
  `<upstream version>-dlux.<N>`.
- Turn on `git rerere` (`git config rerere.enabled true`), so a resolved conflict is reused
  in the next week and in the release build.

## Release order

The release build adds these branches onto the upstream stable tag, in this order.

1. `dlux/chat-cli` - upstream candidate: `orca chat list/read/send`.
2. `dlux/remote-control` - upstream candidate: Claude Remote Control in chat tabs.
3. `dlux/launch-refusal-cause` - upstream candidate: a chat create refused before attach reports its reason, not an unknown outcome (#13).
4. `dlux/chat-resume` - upstream candidate: `orca agent launch --surface chat --resume <session-id>` (#4). Stacked on `dlux/launch-refusal-cause`.
5. `dlux/chat-resume-remote-control` - upstream candidate: `orca agent launch --remote-control` (#4). Stacked on `dlux/chat-resume`, with `dlux/remote-control` merged in.
6. `dlux/session-mention` - upstream candidate: `@` lists other chats and terminals (#7).
7. `dlux/quote-chip` - upstream candidate: "Add to chat" quotes show as chips (#5).
8. `dlux/fork-setup` - fork-only: identity, shared profile, update feed, CLI link notice, this file. Always last.

| Branch                            | Base                                         | Kind               | Upstream PR                                                                                                                                  | Files                                                 | Check                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dlux/chat-cli`                   | `upstream-stable`                            | upstream candidate | none yet (shape of [#40836](https://github.com/stablyai/orca/pull/40836), reverted by [#41241](https://github.com/stablyai/orca/pull/41241)) | see "Branch dlux/chat-cli"                            | `pnpm exec vitest run src/cli/agents/chat.test.ts src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-gate.test.ts`                                |
| `dlux/remote-control`             | `upstream-stable`                            | upstream candidate | none yet (includes the auto-enable part of [#40020](https://github.com/stablyai/orca/pull/40020))                                            | see "Branch dlux/remote-control"                      | `pnpm exec vitest run src/main/claude/structured/claude-structured-remote-control.test.ts`                                                                                        |
| `dlux/launch-refusal-cause`       | `upstream-stable`                            | upstream candidate | none yet                                                                                                                                     | fork PR [#14](https://github.com/dluxhu/orca/pull/14) | `pnpm exec vitest run src/main/agent-launch/agent-launch-create-refusal.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-create-refusal.test.ts`                    |
| `dlux/chat-resume`                | `dlux/launch-refusal-cause`                  | upstream candidate | none yet                                                                                                                                     | fork PR [#9](https://github.com/dluxhu/orca/pull/9)   | `pnpm exec vitest run src/main/agent-launch/agent-launch-resume.test.ts src/cli/agents/agent-launch-request.test.ts`                                                              |
| `dlux/chat-resume-remote-control` | `dlux/chat-resume` (+ `dlux/remote-control`) | upstream candidate | none yet                                                                                                                                     | fork PR [#15](https://github.com/dluxhu/orca/pull/15) | `pnpm exec vitest run src/main/claude/structured/claude-structured-remote-control.test.ts src/main/runtime/rpc/methods/agent-launch/agent-launch-surfaces-remote-control.test.ts` |
| `dlux/session-mention`            | `upstream-stable`                            | upstream candidate | none yet                                                                                                                                     | fork PR [#10](https://github.com/dluxhu/orca/pull/10) | `pnpm exec vitest run src/renderer/src/components/native-chat/composer src/shared/orchestration/mailbox`                                                                          |
| `dlux/quote-chip`                 | `upstream-stable`                            | upstream candidate | none yet                                                                                                                                     | fork PR [#12](https://github.com/dluxhu/orca/pull/12) | `pnpm exec vitest run src/renderer/src/components/native-chat/composer/editor src/renderer/src/components/native-chat/selection-quotes`                                           |
| `dlux/fork-setup`                 | `upstream-stable`                            | fork-only          | none                                                                                                                                         | see "Branch dlux/fork-setup: Files"                   | see "Branch dlux/fork-setup: Check"                                                                                                                                               |

To add a branch: base it on `upstream-stable`, add it to the numbered list above (upstream candidates
before fork-only ones), add a row, and add a "Branch" section below.

## Weekly steps

1. Fast-forward `main` to upstream (for upstream submissions):
   `git fetch upstream --tags && git checkout main && git merge --ff-only upstream/main && git push origin main`.
2. If upstream made a stable release this week, move `upstream-stable` to the newest stable
   tag: `git branch -f upstream-stable <tag> && git push --force-with-lease origin upstream-stable`.
3. For each branch in "Release order": `git checkout <branch> && git merge <tag>`. Resolve
   the conflicts with the branch's "Re-apply" notes, run its check, commit, and push it.
4. Build one release on that tag (below). Publish it only on the owner's go-ahead.

## Release steps

1. Start from a clean tree, with the stable tag merged into every branch, and every branch pushed.
2. Run `config/scripts/fork/build-release.sh --remote origin`. Options: `--base <tag>` picks
   a stable tag, `--version <version>` sets the version, `--upstream <name>` names the
   upstream remote.
   - The base is the newest upstream stable tag (`vX.Y.Z`). The script refuses a base that is
     not a stable tag.
   - The version is `<base version>-dlux.<N>`, for example `1.4.259-dlux.1`. N goes up by
     one when the same base is built again.
   - It makes `release/<version>` from the base in a new worktree and adds each branch of
     "Release order" as one commit: the branch's diff from the stable commit it is based on,
     by a 3-way cherry-pick. A stacked branch adds only its own change: its diff from the
     earlier branches of the order that it contains. Then it tags `v<version>` and moves the local `release/latest`
     branch to the tag. It prints the push commands. It never pushes.
   - It refuses a dirty tree and an identity that is not a GitHub noreply address.
   - It warns when a branch does not contain the base tag: merge the tag into the branch.
   - On a conflict it stops with the branch, the files and the clean-up commands. Merge the
     tag into the branch and resolve there, or fix the files in the release worktree and run
     `git rerere` to record the fix. Clean up, and run the script again: rerere replays the fix.
3. Build the app in that worktree, on an Apple Silicon Mac, with Node 24 and pnpm 12.
   Replace `<base>` with the base version (for example `1.4.259`) and `<version>` with the
   release version:

   ```sh
   pnpm install --frozen-lockfile
   pnpm -C mobile install --frozen-lockfile   # build:desktop also builds the mobile web page
   pnpm run build:desktop
   pnpm run build:computer-macos
   pnpm run build:keyboard-layout-macos --single-arch
   pnpm run build:process-footprint-macos --single-arch
   pnpm run build:notification-status-macos --single-arch
   pnpm run ensure:electron-runtime
   # orcad template: common files (daemon and server JS) and darwin-arm64 from this worktree.
   pnpm run build:orcad-prebuilds
   node config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets darwin-arm64
   # The other targets' native slots: from upstream's app of the same version.
   gh release download v<base> -R stablyai/orca -p 'Orca-<base>-arm64-mac.zip' -D /tmp/orca-upstream
   ditto -x -k /tmp/orca-upstream/Orca-<base>-arm64-mac.zip /tmp/orca-upstream
   node config/scripts/fork/graft-orcad-template-targets.mjs /tmp/orca-upstream/Orca.app/Contents/Resources
   ORCA_REQUIRE_ORCAD_TEMPLATE=1 ORCA_LOCAL_BUILD_VERSION=<version> \
     pnpm exec electron-builder --config config/electron-builder.config.cjs --mac zip dmg --arm64 --publish never
   ```

   - Headless `serve` and SSH hosts need `Resources/orcad-template`.
     `ORCA_REQUIRE_ORCAD_TEMPLATE=1` stops the build when the template is missing.
   - Upstream CI builds the native slots of each target on its own runner and merges them
     (`.github/workflows/node-server-tests.yml`, job `desktop_template`). One Mac cannot build
     them. The fork changes no native code, so it uses upstream's slots of the same version.
     The graft script copies only `targets/`, checks each file against upstream's manifest, and
     runs the template check for every target.

4. Test the app in `dist/mac-arm64`. Use a separate profile and port, so a running Orca is not
   touched:

   ```sh
   app="$PWD/dist/mac-arm64/Orca @dLux.app"
   "$app/Contents/Resources/bin/orca" --help
   probe=/tmp/orca-probe; mkdir -p "$probe/home"
   HOME="$probe/home" ORCA_E2E_HOME_DIR="$probe/home" ORCA_E2E_USER_DATA_DIR="$probe" \
     ORCA_USER_DATA_PATH="$probe" ORCA_CLI_INSTALL_PATH="$probe/bin/orca" \
     "$app/Contents/Resources/bin/orca" serve --port 6799 --bind 127.0.0.1 --no-pairing
   ```

   Serve prints "Orca server ready" in less than 30 s. Stop it with Ctrl+C.
   - The `ORCA_E2E_*` variables give serve a mock Keychain. Without them, a build with a new
     code signature waits for the "orca Safe Storage" Keychain prompt. Serve is not ready until
     somebody clicks "Always Allow".
   - `--mac zip dmg` is necessary: the config lists x64 and arm64 for each target, so
     `--arm64` alone also starts an x64 package, and that fails on an arm64-only install.

5. On the owner's go-ahead: `git push origin release/<version> v<version>` and
   `git push --force-with-lease origin release/latest`. Then make the GitHub release on
   `dluxhu/orca` from the tag.

## Default branch and front page

- `release/latest` is the default branch of `dluxhu/orca`, so the GitHub front page shows
  the shipped fork. Each release force-moves it. Nobody bases work on it.
- The front page text is `.github/README.md` (GitHub shows it before the root `README.md`).
  The root `README.md` stays upstream's, so the weekly merge never conflicts on it.
- `main` stays a clean copy of upstream, for upstream submissions. Fork pull requests target
  `upstream-stable` or a patch branch.

## Branch dlux/chat-cli

Upstream candidate. Its PR on the fork holds the description, the files and the re-apply
notes. Its check is in the table above.

## Branch dlux/remote-control

Upstream candidate. Its PR on the fork holds the description, the files and the re-apply
notes. Its check is in the table above.

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

| Identity point                                                                          | Official Orca               | Orca @dLux                                  | File                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Product name (bundle name, Finder)                                                      | `Orca`                      | `Orca @dLux`                                | `config/electron-builder.config.cjs`                                                                                    |
| Bundle id / appId                                                                       | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `config/electron-builder.config.cjs`                                                                                    |
| Local-build contract appId (ShipIt cache, launchd `AssociatedBundleIdentifiers`)        | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `src/shared/local-build-compatibility-contract.json`, `src/shared/local-build-compatibility-contract.ts`                |
| Notification status helper bundle id (default)                                          | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `config/scripts/native-build/macos/build-notification-status-macos.mjs`                                                 |
| Notification settings link                                                              | `com.stablyai.orca`         | `com.stablyai.orca.dlux`                    | `src/main/ipc/notification-system-settings-link.ts`                                                                     |
| Name after ready (app name, About panel, menu title, Quit item), Windows AppUserModelId | `Orca`, `com.stablyai.orca` | `Orca @dLux`, `com.stablyai.orca.dlux`      | `src/main/startup/profile-startup/dev-instance-identity.ts`                                                             |
| "About Orca" and "Hide Orca" menu items                                                 | `Orca`                      | `Orca @dLux`                                | `src/main/menu/register-app-menu.ts` (`withForkName` from `src/shared/fork-identity.ts`)                                |
| Window title, in-app titlebar name                                                      | `Orca`                      | `Orca @dLux`                                | `src/main/window/createMainWindow.ts`, `src/renderer/index.html`, `src/renderer/src/app-shell/TitlebarLeftControls.tsx` |
| TCC prompt watch: responsible bundle ids                                                | official ids                | adds `com.stablyai.orca.dlux` and `.helper` | `src/main/macos-permissions/macos-tcc-prompt-watch.ts`                                                                  |

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
  `orca`; the last one to register owns the link (see Part 3).
- Helper bundle ids (`com.stablyai.orca.computer-use`), dev-build names (`orca-dev`,
  `Orca Dev`) and the headless `orcad` paths.
- The press-and-hold check already accepts `com.stablyai.orca.*` ids.

**Re-apply.** On a conflict, keep the upstream change and put `FORK_IDENTITY.<field>` back in
place of the upstream literal. Never add `extraMetadata.name` or a pre-ready rename for
packaged builds: both change the Keychain item and the userData folder. To find
new bundle id literals that upstream added, run:

```sh
git grep -nE "com\.stablyai\.orca['\"]" -- src config ':!*.test.*'
```

### Part 2: update feed

**What.** The auto-updater reads the releases of `dluxhu/orca` for every channel (stable, RC,
hourly, daily, adhoc). electron-builder publishes to `dluxhu/orca`.

**Why.** An upstream build has the upstream identity. It must never replace the fork.
Upstream data feeds (agent-state rules, WSL hosts policy) still read `stablyai/orca`
through `MAIN_RELEASE_REPO`.

**Files.**

- `src/shared/release-channel.ts` (`APP_RELEASE_REPO`, the channel map, the release-notes link)
- `src/main/updater/lifecycle/updater-setup.ts`
- `src/main/updater/releases/updater-prerelease-feed.ts`
- `src/main/updater/releases/updater-release-readiness.ts`
- `config/electron-builder.config.cjs` (`publish`)
- `config/dev-app-update.yml`

**Re-apply.** Replace each new `github.com/stablyai/orca/releases` literal in updater code with
`APP_RELEASE_REPO`. Then update the test URLs:

```sh
git grep -lE "github.com/stablyai/orca/releases" -- 'src/main/updater/*' src/renderer/src/components/UpdateCard.error-card.test.tsx \
  | xargs sed -i '' 's#github.com/stablyai/orca/releases#github.com/dluxhu/orca/releases#g'
```

### Part 3: CLI link notice

**What.** On macOS, when `orca` on the PATH links to the launcher of another `.app` (for
example official Orca), Settings > Command line says so before you register: the link
belongs to the other app, Register replaces it, and how to switch back. After Register
replaces it, the success toast names the app it replaced and how to switch back.

**Why.** Both apps use the command name `orca` (owner decision). Upstream already treats a
link to any `.app` launcher as "stale" and replaces it without a word.

**Files.**

- `src/main/cli/installation/cli-command-inspection.ts` (`otherMacAppBundle`, the stale detail)
- `src/main/cli/cli-installer.ts` (the detail after install)
- `src/renderer/src/components/settings/cli/install/use-cli-registration-actions.ts` (toast description)

**Re-apply.** Keep the three hunks marked "Fork patch". The test is
`src/main/cli/installation/cli-installer-other-app-notice.test.ts`.

### Part 4: fork documents and release script

**What.** The fork front page `.github/README.md`, this file,
`config/scripts/fork/build-release.sh` and `config/scripts/fork/graft-orcad-template-targets.mjs`
(see "Release steps"). The graft script refuses an upstream app of another version and a
file that does not match upstream's manifest. Its test is
`config/scripts/fork/graft-orcad-template-targets.test.mjs`.

### Part 5: macOS CLI launcher

**What.** `resources/darwin/bin/orca` starts the executable that `CFBundleExecutable` in
`Info.plist` names, not `Contents/MacOS/Orca`.

**Why.** The executable name follows `productName` (`Orca @dLux`). Upstream hardcodes `Orca`.

**Re-apply.** Keep the `ELECTRON=` line. The test is
`src/main/cli/packaged-assets/packaged-cli-assets.test.ts` (its macOS fixture is
`Orca @dLux.app` with an `Info.plist`; it runs on macOS only).

### Part 6: headless orcad Electron fallback

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

`src/main/startup/fork-identity.test.ts` checks the fork values end to end. These upstream
tests change only their expected literals to the fork values:

- Update URLs: `src/main/updater/testing/updater-test-harness.ts`,
  `src/main/updater/updater.build-channel-selection.test.ts`,
  `src/main/updater/updater.check-failure.test.ts`,
  `src/main/updater/updater.check-preflight.test.ts`,
  `src/main/updater/updater.install-failure-cause.test.ts`,
  `src/main/updater/updater.publishing-window-feed.test.ts`,
  `src/main/updater/updater.feed-attempt-lifetime.test.ts`,
  `src/main/updater/mac-install/updater.mac-install.test.ts`,
  `src/main/updater/releases/updater-prerelease-feed.test.ts`,
  `src/main/updater/releases/updater-prerelease-feed-readiness.test.ts`,
  `src/renderer/src/components/UpdateCard.error-card.test.tsx`
- appId: `src/shared/local-build-compatibility.test.ts`,
  `src/main/local-builds/local-build-candidate.test.ts`,
  `src/main/daemon/executable-host/macos/testing/macos-daemon-launchd.test.ts`

### Check

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 src/main/startup src/main/cli src/main/menu src/main/macos-permissions src/main/updater src/shared src/main/local-builds src/main/daemon/executable-host config/scripts/fork src/main/orcad/browser-providers/orcad-browser-provider.test.ts
```

By hand, on macOS, with official Orca signed in first:

1. Quit official Orca. Start Orca @dLux. macOS asks to allow access to "orca Safe Storage":
   click "Always Allow". No prompt means a new key was made: stop.
2. A stored sign-in (for example a GitHub account) works in Orca @dLux.
3. Quit Orca @dLux. Start official Orca. The same sign-in still works.
4. The menu bar, About panel and window title say "Orca @dLux".

### Files

Source and config (25): `src/shared/fork-identity.ts` (new), `config/scripts/fork/build-release.sh` (new),
`config/scripts/fork/graft-orcad-template-targets.mjs` (new), `resources/darwin/bin/orca`,
`src/main/startup/configure-process.ts`, `config/electron-builder.config.cjs`,
`config/dev-app-update.yml`, `config/scripts/native-build/macos/build-notification-status-macos.mjs`,
`src/main/startup/profile-startup/dev-instance-identity.ts`, `src/main/menu/register-app-menu.ts`,
`src/main/window/createMainWindow.ts`, `src/renderer/index.html`,
`src/renderer/src/app-shell/TitlebarLeftControls.tsx`,
`src/main/macos-permissions/macos-tcc-prompt-watch.ts`,
`src/shared/local-build-compatibility-contract.json`,
`src/shared/local-build-compatibility-contract.ts`,
`src/main/ipc/notification-system-settings-link.ts`,
`src/main/cli/installation/cli-command-inspection.ts`, `src/main/cli/cli-installer.ts`,
`src/renderer/src/components/settings/cli/install/use-cli-registration-actions.ts`,
`src/shared/release-channel.ts`, `src/main/updater/lifecycle/updater-setup.ts`,
`src/main/updater/releases/updater-prerelease-feed.ts`,
`src/main/updater/releases/updater-release-readiness.ts`,
`src/main/orcad/browser-providers/orcad-browser-provider.ts`.

Tests (20): `src/main/startup/fork-identity.test.ts` (new),
`config/scripts/fork/graft-orcad-template-targets.test.mjs` (new),
`src/main/startup/fork-identity-electron.test.ts` (new),
`src/main/cli/installation/cli-installer-other-app-notice.test.ts` (new),
`src/main/cli/packaged-assets/packaged-cli-assets.test.ts` (Part 5),
`src/main/orcad/browser-providers/orcad-browser-provider.test.ts` (Part 6) and the 14 files in
"Test changes".

Documents (2): `.github/README.md` (new), `docs/fork/PATCHES.md` (new).
