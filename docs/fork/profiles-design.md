# Orca profiles on macOS: high-level design (orca T #35)

Status: draft 2 for owner review. It includes the owner decisions of 2026-11-20 and the review
findings on draft 1. This is a read-only study. No code is changed. The UI follows the approved
mocks.

Code references are `path:line` on `upstream-stable` (upstream v1.4.259). "(fork)" means branch
`dlux/fork-setup`. "(nightly)" means branch `nightly/fork-setup`.

## Summary

- A profile is a **thin app bundle**, as Chrome makes for its web-app shims. It has its own
  `Info.plist` (bundle id, name, profile id), its own icon and its own copy of the small main
  executable. Everything else is a symbolic link into the default Orca app. Orca signs it ad hoc
  on the Mac. No Developer ID key is necessary.
- Each profile gets a separate bundle id, so it gets separate notifications, a separate Dock icon
  and separate Dock badges.
- The thin bundle does not change when the default app updates. Its ad-hoc signature, and the
  TCC and Keychain grants that depend on it, stay. A profile runs the new version after a restart.
- A separate thin app, "Orca Profile Manager", lists, creates and removes profiles, and handles
  `orca:` links.
- Orca already keys all runtime state to the userData folder: the instance lock, the CLI socket
  and metadata, the serve service and the WebSocket port. A profile needs little new runtime code.
- If slice 1 shows that macOS or Electron refuses the thin bundle, the fallback is a full APFS
  clone of the default app (section 1, option a).

## 0. What Orca has today

| Fact | Evidence |
| --- | --- |
| The single-instance lock is per userData. | `src/main/startup/profile-startup/single-instance-lock.ts:20-29`, `desktop-profile-instance-lock.ts:22` |
| The CLI finds the app through `<userData>/orca-runtime.json` (pid, socket, token). | `src/shared/runtime-bootstrap.ts:17-23,42-45`, `src/cli/runtime/metadata.ts:11-31` |
| The runtime socket is per userData. | `src/main/runtime/rpc/server/runtime-rpc-socket-metadata.ts:58-76` |
| Each terminal gets `ORCA_USER_DATA_PATH`, `ORCA_CLI_COMMAND` and the app's `bin` folder first in `PATH`. So `orca` in a terminal of profile X already talks to X. | `src/main/cli/launchers/orca-cli-child-path.ts:28-39` |
| `orca open` for another userData starts a second instance of the same bundle (`open -n … --user-data-dir`). | `src/cli/runtime/launch.ts:110-116` |
| The serve service (LaunchAgent) is per userData. | `src/cli/runtime/serve-service-unit.ts:52-54,68-71` |
| Each desktop instance has its own WebSocket endpoint, pairing identity and saved fallback port. | `src/main/runtime/rpc/server/runtime-rpc-lifecycle.ts:135-146` |
| Upstream has in-app "Orca profiles": several profiles in one userData, one active at a time, UI hidden behind `ORCA_MULTI_PROFILE_UI`. | `src/main/orca-profiles/profile-storage-paths.ts:11-13,35-49`, `profile-ui-scope.ts:2-3`, `src/shared/orca-profiles.ts:6-7` |
| The fork identity is set at build time. The nightly build changes it with `sed` in the release commit. | `src/shared/fork-identity.ts` (fork, nightly), `config/scripts/fork/build-release.sh:193-206` (nightly) |
| The main executable is a 53 KB loader. It imports only `ElectronMain`, `ElectronInitializeICUandStartNode` and `electron::fuses::IsRunAsNodeEnabled` from `@rpath/Electron Framework.framework`, with `LC_RPATH @executable_path/../Frameworks`. | `otool -L`, `otool -l`, `nm -u` on an installed fork build |
| The asar integrity fuse is off, so Electron does not check `ElectronAsarIntegrity` in `Info.plist`. | fuse bytes `101100011` in the installed `Electron Framework` (position 5 = `EnableEmbeddedAsarIntegrityValidation` = 0) |

Name clash: upstream's in-app profiles are the "one active profile" model that the ticket rejects.
This design calls ours "app profiles" in code and "Profiles" in the UI. The upstream switcher
stays hidden. Each app profile has its own upstream profile index inside its own userData.

## 1. What a profile app is on disk

| Option | Bundle id that macOS sees | Notifications, Dock, badges | Disk | After an update of the default app | Verdict |
| --- | --- | --- | --- | --- | --- |
| T. **Thin bundle**: own `Info.plist`, icon and main executable; links to the default app; ad-hoc signed | the profile's | separate | about 1 MB | not changed: same signature, grants stay; runs the new version after a restart | **Recommended** (owner: "do it the Chrome way") |
| a. APFS clone of the default app, changed `Info.plist` and icon, signed again | the profile's | separate | about 0 until the default app updates | must be cloned and signed again: an ad-hoc signature changes, grants are lost | Fallback if slice 1 fails for T |
| b. Stub `.app` that starts the Orca executable with `--user-data-dir` | Orca's: a process belongs to the bundle that holds its executable | shared with the default app | ~100 KB | not changed | Rejected: fails the notification requirement |
| b0. `open -n` on the same app (what `launch.ts:110-116` does today) | Orca's | shared: one settings entry, two Dock tiles with the same icon | 0 | not changed | Rejected: same reason |
| c. Chrome's full app-shim model (the shim process owns the Dock tile; the browser process draws the windows into it) | the shim's | separate | small | not changed | Not possible: Electron cannot draw windows into another process |

### How Chrome does it, and what carries over

Chrome makes a small shim bundle for each web app. The shim loads `Google Chrome Framework.framework`
from the installed Chrome. Chrome signs each shim ad hoc on the Mac to give it its own identity
(Chromium feature `kUseAdHocSigningForWebAppShims`; Edge policy `AdHocCodeSigningForPWAsEnabled`
says that without it all web apps share one identity). Chrome's shim finds the framework at run
time. Electron cannot do that: it finds `Contents/Frameworks` and `Contents/Resources` from the
main bundle. So the Orca thin bundle uses symbolic links at those two places. The identity part
(a small own bundle, signed ad hoc on the Mac, unchanged at updates) is the same as Chrome's.

### Layout (option T)

```
~/Applications/Orca Profiles/Orca - Work.app/Contents/
  Info.plist                          own (table below)
  PkgInfo                             copy
  MacOS/<executable>                  own copy of the default app's 53 KB main executable
  MacOS/orca-notification-status      own copy of the profile variant of the helper (finding below)
  MacOS/orca-keyboard-layout          link -> <default app>/Contents/MacOS/orca-keyboard-layout
  MacOS/orca-process-footprint        link -> <default app>/Contents/MacOS/orca-process-footprint
  Frameworks                          link -> <default app>/Contents/Frameworks
  Helpers                             link -> <default app>/Contents/Helpers
  Resources/icon.icns                 own icon
  Resources/<each other entry>        link -> <default app>/Contents/Resources/<entry>
  _CodeSignature/CodeResources        ad-hoc seal
```

`Resources` is a real folder, because the icon must be in it. It holds one link for each
top-level entry of the default app's `Resources` (73 entries today: `app.asar`,
`app.asar.unpacked`, `bin`, the `.lproj` folders, `orcad-template`, `Orca Computer Use.app`, …).

The links point to fixed paths, so their targets do not change when the default app updates.
The seal records a link as a link (its target path), not the content behind it.

| `Info.plist` key (start from a copy of the default app's file; edit with `plutil`, which reads XML and binary files) | Value | Why |
| --- | --- | --- |
| `CFBundleIdentifier` | `<default appId>.profile.<id>`, with `_` changed to `-`. Example: `com.stablyai.orca.dlux.profile.work` | A bundle id allows only `A-Z a-z 0-9 . -`. The prefix keeps the `com.stablyai.orca.*` checks working (`src/shared/fork-identity.ts:4` (fork)). |
| `CFBundleDisplayName` | the profile name | |
| `OrcaAppProfileId` (new) | `work` | The main process reads it at start. |
| `CFBundleURLTypes` | removed, **from slice 1** | Only the Profile Manager dispatches `orca:` links (section 5). A profile that claims the scheme could take the links. |
| `ElectronAsarIntegrity` | removed | The fuse is off (section 0). The value would be out of date after each update. If upstream turns the fuse on, the plist must carry the hash, and it changes at each update. |
| `CFBundleName`, `CFBundleExecutable`, usage descriptions, `LSEnvironment`, `NSPrincipalClass` | not changed | Electron finds `<name> Helper.app` from the bundle name. TCC prompts read the usage descriptions of the profile bundle. |
| `CFBundleShortVersionString` | not changed | It stays the version of creation. Finder shows that version. `app.getVersion()` reads `package.json` in `app.asar`, which follows the default app. |

The `.app` file name is the name that Finder and the Dock show.

### What Electron and macOS must accept (slice 1 tests each item)

| Item | Expected | If it fails |
| --- | --- | --- |
| `codesign` signs a bundle whose `Frameworks`, `Helpers` and `Resources/*` are links that point outside the bundle | The seal records links as links. `codesign --verify --strict` rejects links that point outside a bundle. Slice 1 checks that signing works, and that launch, notifications and TCC accept the bundle on macOS 14, 15 and 26. | Sign first, then add the links (the seal does not list them). If that also fails: option a. |
| dyld resolves `@executable_path/../Frameworks` through the `Frameworks` link | Yes: the file system resolves the link. | option a |
| Library validation | Off: the ad-hoc main executable has no hardened runtime, so it loads the framework that the release signed. Never sign with `--options runtime` (or add `com.apple.security.cs.disable-library-validation`). | — |
| `process.resourcesPath` | `<profile>/Contents/Resources`. Each entry resolves through its link. 164 lines in `src/main` use `resourcesPath`. Slice 1 runs a smoke test: terminal, agent, browser, computer use, `orcad` template, `orca` CLI. | Fix the code that compares real paths. |
| Electron helper lookup | `Contents/Frameworks/<CFBundleName> Helper (…).app` through the link. The helper bundle ids stay `com.stablyai.orca.dlux.helper.*`. | option a |
| The `orca` launcher in `Resources/bin` | `cd -P` in the launcher resolves the `bin` link, so the CLI runs from the default app. `ORCA_USER_DATA_PATH` still points it to the profile. | — |
| Notification helper identity (finding below) | The profile variant of the helper reports the profile's notification settings. | Report "unknown" for the profile. |

**Notification helper.** `config/scripts/native-build/macos/build-notification-status-macos.mjs:2,25`
(fork) embeds the default app's `CFBundleIdentifier` in `__TEXT,__info_plist`. `codesign -i` changes
the signature identifier but not that embedded section. So the release also builds a profile
variant of `orca-notification-status` with no embedded `Info.plist`. It ships in the default app as
`Contents/Resources/profile-template/orca-notification-status` (it does not run from there; macOS 26
aborts notification helpers that run from `Resources`, `config/electron-builder.config.cjs:665`
(fork)). The profile gets a copy in its own `Contents/MacOS`, signed with `-i <profile bundle id>`.
Slice 1 checks it: turn the profile's notifications off in System Settings; the profile's helper
reports `denied`, and the default app's helper still reports `authorized`.

### Changes in the main process

- Before `configureDevUserDataPath` (`src/main/startup/main-process-preflight.ts:204`; the fork pin
  is at `configure-process.ts:223-225` (fork)): read `OrcaAppProfileId` from the app's own
  `Info.plist`. If it is set, set userData to `~/Library/Application Support/Orca Profiles/<id>`.
- Read the bundle id and name at runtime, not from the build-time `FORK_IDENTITY`, in these places:
  `dev-instance-identity.ts:59-71`, `src/main/ipc/notification-system-settings-link.ts:4-10`,
  `src/main/window/createMainWindow.ts:128`, the renderer title bar (all fork). One helper,
  `runtimeAppIdentity()`, serves them all.
- `src/main/macos-permissions/macos-tcc-prompt-watch.ts:12-21` (fork) has a closed set of bundle
  ids. Change it to a prefix match on `com.stablyai.orca.`, so it accepts each profile and the
  shared helper ids.
- Turn the updater off in a profile: the gate at `src/main/updater/lifecycle/updater-setup.ts:144` (fork).
- Do not rename the app before `ready`. The Keychain service stays "orca Safe Storage"
  (`dev-instance-identity.ts:16-19` (fork)).

## 2. Signing

Owner decision: sign ad hoc on the Mac, as Chrome does. The user needs no Developer ID key.

```sh
codesign --force -s - -i <bundle id> "<profile>/Contents/MacOS/orca-notification-status"
codesign --force -s - -i <bundle id> --entitlements <ent> "<profile>"
```

- `<ent>` is the entitlements of the default app (`codesign -d --entitlements`). All of them
  (`resources/build/entitlements.mac.plist` (fork)) are allowed in an ad-hoc signature.
- No `--deep`: the linked frameworks and helpers keep the release signatures.
- No `--options runtime` (library validation, section 1).
- Then register the bundle: `lsregister -f <profile>` (the Launch Services tool in
  `CoreServices.framework`).

**The release signature.** An installed fork build has a Developer ID signature with no hardened
runtime and no notarization (`codesign -dv` shows `flags=0x0`; `spctl` shows "Unnotarized
Developer ID"). The fork's release steps build without `ORCA_MAC_RELEASE`
(`docs/fork/PATCHES.md`, "Release steps"), so `hardenedRuntime` and `notarize` are off
(`config/electron-builder.config.cjs:105,645,647` (fork)). electron-builder signs with an identity
that it finds in the keychain of the build machine, and signs ad hoc when there is none (the same
rule for the Computer Use helper: `:828-832`). Users do not have the key. The thin bundle does not
need it.

| Grant | What macOS stores for an ad-hoc app | Thin bundle (T) | Clone (a) |
| --- | --- | --- | --- |
| TCC (Accessibility, Screen Recording, Automation, Files and Folders, Camera, Microphone) | the cdhash of the main executable. The code directory includes the hashes of `Info.plist` and of the seal. | kept at updates | lost at each rebuild |
| Keychain "orca Safe Storage" ("Always Allow") | the cdhash | one prompt for each profile, then kept | prompt again at each rebuild |

The thin bundle changes only when its own parts must change (section 7). Then it is signed again,
and each grant is asked for once more.

- **Quarantine and notarization.** Orca writes the bundle itself, so it gets no
  `com.apple.quarantine`. Gatekeeper does not check it, and it needs no notarization.
- **TCC.** Each profile asks once for each service. `Orca Computer Use.app` (linked) keeps its own
  id and grants, and all profiles share it.
- **Keychain.** All profiles keep the pre-ready name `orca`, so they use the same item "orca Safe
  Storage" (one key; the default app and official Orca use it too). The encrypted data is
  separate, because each userData is separate.
- **App Management (macOS 13 and later).** A change to an app bundle can show "Orca would like to
  modify apps". The thin bundle seldom changes. A rebuild writes a new bundle to a temporary path
  and swaps it in with a rename. Slice 1 tests it.

## 3. Data

| Item | Where | Scope |
| --- | --- | --- |
| Registry | `~/Library/Application Support/Orca Profiles/profiles.json` | all profiles |
| Profile userData: settings, chats, terminal daemon, worktree records, browser sessions, upstream in-app profiles, `orca-runtime.json`, socket, pairing identity, WebSocket port | `~/Library/Application Support/Orca Profiles/<id>/` | one profile |
| Profile Manager userData (Electron needs one; no runtime data) | `~/Library/Application Support/Orca Profiles/.manager/` | the Profile Manager |
| Default profile userData | `~/Library/Application Support/orca` (shared with official Orca: fork `docs/fork/PATCHES.md` Part 1) | default profile |
| Worktree folders | where the settings of each profile put them | the file system is shared; each profile keeps its own records |
| `~/.orca`: integration credentials (Linear, Jira, Bitbucket, API keys) and agent hook scripts | `git grep -l -F "join(homedir(), '.orca'" -- src ':!*.test.*'` finds 14 files on `upstream-stable`, for example `src/main/linear/accounts/linear-credential-paths.ts:7-9`, `src/main/credentials/encrypted-api-key-file-store.ts:42-44`, `src/main/agent-hooks/installation/scripts/managed-hook-script-path.ts:6` | **shared** (question Q4) |
| Agent configs (`~/.claude` and others), git, SSH | home folder | shared |
| `orca` CLI link | the user's PATH | one link, from the default app |
| Keychain item | login keychain | shared |

The profile folders are outside the `orca` folder, so official Orca never sees them.

**New profile.** It starts empty and shows onboarding. The create dialog has the option "Copy
settings from the default profile". It copies the settings only, not chats, projects, worktrees,
sign-ins or encrypted values. The copy seeds the new profile's state through the same start path
that upstream uses for a new in-app profile (`initializeNewOrcaProfileState`,
`src/main/orca-profiles/storage/new-profile-state.ts:17-40`), with the default profile's settings in
place of the defaults.

## 4. How profiles know each other

`profiles.json` (paths are absolute in the real file):

```json
{
  "version": 1,
  "defaultAppPath": "/Applications/<default app>.app",
  "urlHandler": { "mode": "ask" },
  "profiles": [
    {
      "id": "work",
      "name": "Orca - Work",
      "bundleId": "com.stablyai.orca.dlux.profile.work",
      "appPath": "~/Applications/Orca Profiles/Orca - Work.app",
      "userDataPath": "~/Library/Application Support/Orca Profiles/work",
      "icon": { "kind": "badge", "text": "2", "style": "ref-match" },
      "templateKey": "<hash of the parts in section 7>",
      "createdAt": 1763600000000
    }
  ]
}
```

- `urlHandler.mode` is `ask`, or `profile` with a `profileId`. The default profile is implicit,
  with id `default`. Other `icon.kind` values: `image` (an uploaded badge) and `file` (an uploaded
  full icon).
- **One writer.** Only the Profile Manager writes the file, with a temporary file and a rename.
  The profiles read it and watch it with `fs.watch`.
- **Status.** Each row shows "Service running" or "Service stopped" (owner), not the window state.
  "Running" means that the profile app process is alive, with or without a window (question Q1).
  Read `<userData>/orca-runtime.json` and test its pid with signal 0, as
  `runtime-rpc-socket-metadata.ts:43-47` does. No new port.
- **Open.** Each row has "Open": `open -b <bundleId>`. It brings the profile to the front and opens
  a window, or starts it.
- **Messages.** Use the profile's unix socket and token from `orca-runtime.json`, as the CLI does
  (`src/cli/runtime/metadata.ts:11-31`).
- **Profiles menu** (owner): a top-level "Profiles" menu in the menu bar of every profile, of the
  default app and of the Profile Manager. It lists each profile with its status, a check mark on
  the current one, and "Profile Manager…". A click on a profile does the same as "Open". It is
  built in `src/main/menu/register-app-menu.ts` (fork) as its own top-level menu, not a submenu of
  the app menu.

### The Profile Manager app

Owner decision: the Profile Manager is a separate app, not part of Settings (as Firefox has a
separate profile manager).

- `~/Applications/Orca Profiles/Orca Profile Manager.app`: a thin bundle of the same kind as a
  profile, with bundle id `<default appId>.profile-manager`, `OrcaAppRole = profile-manager` in its
  `Info.plist`, and its own badged icon. It keeps `CFBundleURLTypes`, because it is the `orca:`
  dispatcher (section 5).
- It starts Orca in Profile Manager mode: the main process opens only the Profile Manager window.
  It starts no runtime, no agents and no updater. It works when no profile runs.
- The default app makes it the first time the user selects "Profiles > Profile Manager…" (and
  `orca profiles manager` makes it from the CLI).
- Alternative (question Q2): a separate window of the default app, started with
  `--profile-manager` (as `firefox -P`).

## 5. The `orca:` URL

- **Today.** The build registers the scheme: `config/electron-builder.config.cjs:256` (fork) writes
  `CFBundleURLTypes`. The `open-url` handler (`src/main/index.ts:150-156`) claims only the links
  that `isRoutedOrcaDeepLink` accepts: skill-share links and plugin-install links
  (`src/main/startup/open-routing/orca-deep-link-url.ts:5-7`). A cold start reads the same two
  kinds from `argv` (`index.ts:172-173`). Pairing links (`orca://pair?code=…`,
  `src/shared/remote-runtime/pairing/pairing.ts:19,41`) never go through `open-url`; the user pastes
  them. The app calls `setAsDefaultProtocolClient` only on Windows
  (`src/main/startup/open-routing/orca-protocol-registration.ts:12`).
- **Launch Services.** When several bundles claim a scheme, the stored default
  (`LSSetDefaultHandlerForURLScheme`) wins. Without one, Launch Services selects one by its own
  rules, which are not documented and not stable. The fork and official Orca both claim `orca:`
  today (fork `PATCHES.md`, "Not changed on purpose").
- **Design.** The Profile Manager app is the handler. When it is made, it calls
  `app.setAsDefaultProtocolClient('orca')` on macOS (extend `orca-protocol-registration.ts:12`).
  Profile apps do not claim the scheme (section 1). The default app keeps its claim, because its
  bundle comes from the release.
- **Dispatch.** The Profile Manager takes **every** `orca:` URL, not only the two routed kinds:
  - mode `profile` with profile X (or the default profile): forward the URL to X, with no window;
  - mode `ask`: show only the chooser window, with the profiles (running ones first) and an
    "Always use this profile" box that sets the mode. It never opens the default app's main window.
  - If the Profile Manager started only for this link, it quits after the forward.
- **Forward.** `open -a <appPath> <url>` sends the URL event to the running app, or starts the app
  and then sends it. The `open-url` handler is registered before `ready` (`index.ts:150`), so a cold
  start gets it. The target handles the kinds that it supports, as today. Slice 1 verifies that
  Electron fires `open-url` for a scheme that the bundle does not claim (question Q10). Fallback: a
  new runtime call over the target's socket that passes the URL to the same handler; for a stopped
  target, start it with `open -b` first, wait for `orca-runtime.json`, then make the call.

## 6. CLI

**Today.** `orca` uses `ORCA_USER_DATA_PATH`, else the platform default
`~/Library/Application Support/orca` (`src/cli/runtime/metadata.ts:42-58`,
`src/cli/runtime/launch-user-data-path.ts:11-21`). Then it reads `orca-runtime.json`. In an Orca
terminal, the app sets `ORCA_USER_DATA_PATH` and `ORCA_CLI_COMMAND`, and puts its `bin` folder first
in `PATH` (`src/main/cli/launchers/orca-cli-child-path.ts:28-39`). (The upstream nightly launcher
also hands off to `ORCA_CLI_COMMAND`: `resources/darwin/bin/orca:15-21` (nightly). The stable
launcher does not.)

**Flag clash.** `--profile` is already the browser profile flag
(`src/cli/specs/browser-basic.ts:232-275`, `src/cli/specs/browser-advanced.ts:10`,
`src/cli/browser/browser-tab.ts:80`). `orca profile state … --profile-id` is upstream's in-app
profile (`src/cli/specs/profile-state.ts:6-19`).

**Design.**

- `orca --profile <id> <command> …` (also `--profile=<id>`): valid only before the command. The
  CLI entry removes it from `argv` at the start of `main()` (`src/cli/index.ts:45-48`), before the
  version check and before `parseArgs` (`index.ts:74`) and `validateCommandAndFlags`
  (`src/cli/arguments/args.ts:216`, called at `index.ts:104`). Those two would reject the flag, and
  a global value flag would also take the browser `--profile`. The entry finds the id in the
  registry and sets `ORCA_USER_DATA_PATH`. Then every command works with no change of its own.
  After the command, `--profile` keeps its browser meaning.
- `ORCA_PROFILE=<id>` does the same.
- Order: `--profile`, then `ORCA_PROFILE`, then `ORCA_USER_DATA_PATH` (set in every Orca terminal),
  then the default profile.
- An unknown id stops with an error that lists the ids.
- `orca profiles create|rebuild|remove|list|manager` are local commands. They do not need a
  running app or runtime (Node, `cp`, `ln`, `plutil`, `codesign`, `lsregister`).

| Command | Profile scope |
| --- | --- |
| Runtime commands (`chat`, `terminal`, `worktree`, `tab`, `agent`, `project`, `status`, …) | one profile, from the order above |
| `orca open` | starts that profile app with `open -a <appPath>`, not `open -n … --user-data-dir` (change `launch.ts:85-91,110-116`) |
| `orca serve`, `orca serve service …` | **always the default profile** (owner). No setting. `--profile` and `ORCA_PROFILE` are refused, and an `ORCA_USER_DATA_PATH` of a profile is ignored for serve. The existing rule still applies: serve refuses while the default desktop app runs (`src/cli/specs/serve.ts:39`). |
| `orca profiles list [--json]` (plural, so it does not clash with `orca profile state`) | all profiles: id, name, app path, service status |
| CLI registration (Settings > Command line) | only in the default app; hidden in profiles |

Remote clients: each running desktop profile has its own WebSocket endpoint and pairing identity
already (`runtime-rpc-lifecycle.ts:135-146`). Serve reaches only the default profile.

## 7. Updates

- The updater is off in a profile app and in the Profile Manager. A profile runs the code of the
  default app through its links, so it follows the default app's version with no update of its own.
- **Restart rule.** A running profile must not see the default app's files change under it: a new
  helper or a new `app.asar` with an old main process can crash it. So:
  - When an update is ready, the default app does not install it while a profile runs. Its update
    card shows "Restart all Orca apps to update".
  - That action quits each running profile (a runtime call over its socket), installs the update,
    starts the default app, and starts again the profiles that ran.
  - `autoInstallOnAppQuit` (`src/main/updater/lifecycle/updater-setup.ts:156` (fork)) stays off while
    a profile runs, so a quit of the default app alone does not install it.
- **When the thin bundle must change.** The Profile Manager stores a `templateKey`: a hash of the
  default app's top-level `Resources` names, the `Info.plist` keys that the profile copies, and the
  imports of the main executable (`nm -u`). After an update, if the key is different, the next
  start of the profile rebuilds its bundle (new links or plist keys, sign again). This changes the
  cdhash, so TCC and the Keychain ask once more. It is rare: the 73 entry names, the plist and the
  three imports seldom change.
- If the default app moves or is renamed, the links break. The Profile Manager finds this from
  `defaultAppPath` and offers "Repair", which makes the links again (and changes the cdhash).
- Option a (fallback) needs a full rebuild after each update, with lost grants each time.

## 8. Icons

**Owner decision (2026-11-20):** reimplement the renderer of dock-icon-badger (MIT) in
TypeScript inside Orca. No Python at run time, and no Python in the repository. Port `ref-match`
first, then the other styles.

### Image library

Orca has no general image library. `sharp`, `canvas` and `jimp` are not dependencies.
`pngjs` is a dev dependency only, and `fflate` (zlib) is a runtime dependency (`package.json`, `upstream-stable`).
So:

| Layer | Tool | Why |
| --- | --- | --- |
| Raster core: masks, blur, resize, polygons, compositing, the styles | **plain TypeScript** on `Float32Array` / `Uint8ClampedArray` RGBA buffers (1024 x 1024) | Deterministic, so golden tests can compare it with the Python output. It runs in Node (vitest) and in the renderer. No new dependency. |
| Character badge (text to image) | **`OffscreenCanvas` in the Profile Manager renderer**, `fillText` with a bold system font | Text needs a font rasterizer. Chromium has one. |
| Decode an uploaded badge (PNG, JPEG, WebP, SVG) | `createImageBitmap` / `<img>` in the renderer, then `getImageData` | Chromium decodes all four. SVG needs no cairo. |
| Decode an uploaded ICNS icon | `sips -s format png` (part of macOS) | Chromium does not decode ICNS. |
| Encode PNG | `nativeImage.createFromBitmap(buf, { width, height }).toPNG()` in main | Electron built-in. |
| Live preview | the same core, called from the renderer | One code path for preview and output. |

Do not use Canvas 2D drawing (`filter: blur()`, `drawImage` scaling, path fill) inside the core.
Their anti-aliasing and blur differ from Pillow, and they can differ between GPU and CPU. The core
copies Pillow's algorithms, so the output matches.

### `.icns`

Make the 10 iconset sizes (16 to 1024, with `@2x`) with the core's Lanczos resize. Write the file
with a TypeScript writer: the `icns` header and one PNG entry for each size, as in the fallback
writer of `write_icns` in `dock_icon_badger.py` (about 25 lines). It needs no tool and no
temporary folder. `iconutil -c icns` (part of macOS) is the fallback if macOS refuses the file.
Then sign again, `touch` the bundle and register it again with Launch Services, so the Dock and
Finder show the new icon.

### What the port needs

Counts are code lines of `dock_icon_badger.py` (854 lines in total; comments and empty lines not
counted).

| Part | Python functions | Lines | Phase |
| --- | --- | --- | --- |
| Constants of the icon grid and the curl | lines 24-68 | 31 | ref-match |
| Squircle path parser and mask | `_svg_path_polys`, `_arc`, `squircle_mask`, `SQUIRCLE_D` | 66 | ref-match |
| Helpers | `shadow`, `edge_ring`, `ss_`, `bez` | 15 | ref-match |
| Base icon normalization | `masks`, `apple_icon`, `normalize_icon` (only the "macOS-shaped" path for the Orca icon) | about 45 | ref-match |
| Badge image | `Logo` (`sized`, `on_white`), `fill_holes`, `key_out_white` | about 45 | ref-match |
| Curl | `grid`, `_paper`, `page_curl`, `st_ref_match` | 70 | ref-match |
| Parameters and `.icns` | `style_params`, `write_icns` | about 35 | ref-match |
| Other styles | tiles, `frosted`, `liquid-glass`, `round`, `sticker`, `stamp` (87); `page-curl` (34); `gentle-curve`, `rolled-cylinder`, `round-peel` (20); `dominant_color`, `tint` (14); shared helpers (17) | 172 | later, one style per change |
| Not ported | CLI, preview sheet, SVG rendering through cairo, `.app` and `.iconset` loading, the web UI server | about 110 | — |

So `ref-match` needs about 300 lines of Python. Pillow and numpy give some parts that TypeScript
must now supply:

| Primitive | Pillow behavior to copy | Used by |
| --- | --- | --- |
| Gaussian blur | `ImageFilter.GaussianBlur` (Pillow's extended box blur, 3 passes) | shadows, `key_out_white`, frosted |
| Lanczos resize | `Image.LANCZOS` (16 calls) | badge sizes, iconset sizes |
| Polygon fill with supersampling, then box downsample | `ImageDraw.polygon` at 4x or 8x, then `Image.BOX` | squircle, flap |
| Min and max filter | `MinFilter`, `MaxFilter` | `edge_ring`, body margin, `fill_holes` |
| Flood fill | `ImageDraw.floodfill` | `fill_holes`, `key_out_white` |
| Alpha compositing | `alpha_composite`, `putalpha`, `ImageChops.multiply`, `lighter`, `subtract` | everywhere |
| Rotation | `Image.rotate` (bicubic) | `sticker`, `stamp` only |

Estimate: about 700 lines of TypeScript for `ref-match` with the primitives, and about 1,200 for
all 14 styles. Put the core in `src/shared/icon-badger/` (no Electron import), the PNG and `.icns`
I/O in `src/main/app-profiles/`, and the text badge in the Profile Manager renderer. Keep the MIT
notice of dock-icon-badger in the ported files.

### Tests against dock-icon-badger's own output

- **Fixtures,** made once on a development machine with the Python tool, and committed with the
  tool's commit id and the command line:
  - base: Orca's `resources/build/icon.png`;
  - badges: a PNG of the character "2" (rendered once and committed, so both sides use the same
    badge pixels), and one logo PNG with holes;
  - output: one 1024 px PNG for each base x badge x style.
- **Test:** vitest decodes the base and badge PNGs with `pngjs` (dev dependency), runs the
  TypeScript core in Node, and compares with the Python PNG.
- **Limit:** on premultiplied RGBA, at least 99.5 % of pixels differ by 8 or less (of 255) in each channel,
  a mean absolute difference of 1.0 or less, and no pixel more than 48 off. On a failure, the test
  writes a difference PNG for review.
- **Primitive tests:** each primitive (blur, Lanczos, polygon fill) also has a small golden test
  against Pillow output, so a failure points to one primitive and not to the whole style.
- **Mutants:** change one curl constant (for example `ARC_MID`) or the blur sigma; the golden test
  must turn red.
- The character text itself is drawn by Chromium and is not compared with Python. Its test checks
  only the size and position of the glyph box.

### Inputs and defaults

- **Base icon:** the default app's own icon (`resources/build/icon.png`, 1024 px, already on the
  macOS grid).
- **Uploaded badge:** PNG, JPEG, WebP or SVG, with any style.
- **Uploaded full icon:** PNG or ICNS, used as it is.
- **Default character:** the first of "2" to "9", then "A" to "Z", that no other profile uses.
  Default style: `ref-match`.

## 9. Ids, rename and remove

Id from the name:

1. Remove the word "Orca" (any case) and a leading "-".
2. Change each character that is not `A-Z a-z 0-9` to a space.
3. Trim, change to lower case, and join the words with `_`. "Orca - New Profile" becomes `new_profile`.
4. An empty result becomes `profile`. An id in use gets `_2`, `_3`, and so on.

Rules:

- Pattern `^[A-Za-z0-9][A-Za-z0-9_]{0,31}$`. The id keeps its case.
- It must be unique when case is ignored, because the default APFS volume and bundle ids ignore case.
- `default`, `all` and `manager` are reserved.
- The user can edit the id in the create dialog.
- The name starts as "Orca - New Profile", then "Orca - New Profile 2", 3, and so on. The name
  must be unique, and is also the `.app` file name, so it cannot contain `/` or `:`.

**Rename** changes the name only: rename the `.app`, set `CFBundleDisplayName`, sign again, and
write the registry. The profile must quit first. The id, the bundle id and the userData do not
change. A rename changes the cdhash, so TCC and the Keychain ask once more.

**Change of id after creation** is not in this design. A new bundle id loses the notification
settings, the TCC grants and the Keychain access, and the userData must move.

**Remove:**

1. Ask the profile to quit (a new runtime call over its socket; else SIGTERM to its pid).
2. Move the `.app` to the Trash.
3. Move the userData folder to the Trash, or keep it ("Keep data" option).
4. Remove the registry entry.
5. Unregister the app from Launch Services (`lsregister -u`), and run `tccutil reset All <bundleId>`.
6. If the profile handled `orca:` URLs, set the mode to `ask`.

## 10. Risks and open questions

Each question has a recommended default.

| # | Question or risk | Recommended default |
| --- | --- | --- |
| Q1 | What does "Service running" mean? | The profile app process is alive (its runtime keeps agents and terminals running), with or without a window. "Service stopped" means that no process runs for the profile. |
| Q2 | Profile Manager: a separate app, or a window of the default app (`--profile-manager`, as `firefox -P`)? | The separate app "Orca Profile Manager", a thin bundle. It has its own Dock icon, works with no profile running, and dispatches `orca:` links. |
| Q3 | Does `codesign` sign, and does macOS 14, 15 and 26 launch, a bundle with links that point outside it? Do notifications and TCC accept it? | Test first in slice 1. If signing refuses the links: sign, then add the links. If launch, notifications or TCC refuse: use option a (clone) and accept the lost grants at updates. |
| Q4 | `~/.orca` (integration credentials, hook scripts) is shared, so a "work" profile shares Linear, Jira and Bitbucket sign-ins with "personal". | Shared in v1, with a note in the Profile Manager. Later: an `ORCA_HOME_DIR` override for credential stores only. |
| Q5 | `--profile` clashes with the browser `--profile` flag. | `--profile` only before the command, removed from `argv` before `parseArgs`, plus `ORCA_PROFILE`. |
| Q6 | A running profile while the default app updates. | The update installs only after "Restart all Orca apps"; it quits and starts again each running profile. |
| Q7 | What does Remove do with the data? | Move the app and the data to the Trash. "Keep data" is an option. |
| Q8 | Can the id change after creation? | No. Rename changes only the name. |
| Q9 | The nightly build has its own default profile (`orca-dlux-nightly`). | The nightly build gets the same feature with its own names: registry and folders "Orca Nightly Profiles", profiles linked to the nightly app, its own Profile Manager. Stable and nightly profiles do not see each other. All names come from `FORK_IDENTITY`, so this needs no extra code. |
| Q10 | Does `open -a <app> <url>` deliver `open-url` to a bundle that does not claim `orca:`? | Test in slice 1. Fallback: a runtime call over the target's socket. |
| Q11 | App Management prompt when Orca writes or changes a profile bundle. | Test in slice 1. Write the new bundle to a temporary path and swap it with a rename. |
| Q12 | Electron helper lookup and `process.resourcesPath` through the links. | Keep `CFBundleName` and `CFBundleExecutable`. Smoke test in slice 1. |
| Q13 | The profile's `Info.plist` keeps the version of creation, so Finder "Get Info" shows an old version. | Accept. An update of that key would change the cdhash at each update. |
| Q14 | What does "Copy settings from the default profile" copy? | Settings only. Not chats, projects, worktrees, sign-ins or encrypted values. |
| Q15 | The default app moves or is renamed: the links break. | The Profile Manager shows "Repair" and makes the links again. |
| Q16 | Branch: the feature reads the fork identity, but `dlux/fork-setup` is always last in the release order. | A fork-only branch `dlux/profiles`, stacked on `dlux/fork-setup`, last in the order. Update the rule in `PATCHES.md`. |

## 11. Phased plan

Each slice is one PR with its own tests.

| Slice | Content | Done when |
| --- | --- | --- |
| 1. Proof | Main process: read `OrcaAppProfileId`, set userData, runtime identity, updater off, TCC watch prefix match. Release: the profile variant of the notification helper in `profile-template`. A hidden local command `orca profiles create <name>`: the thin bundle, `Info.plist` by `plutil` (no `CFBundleURLTypes`, no `ElectronAsarIntegrity`), links, ad-hoc signature, `lsregister -f`, the registry. | Two profiles run at the same time, each with its own Dock icon and badge, and its own entry in System Settings > Notifications. A notification from each shows its own name, and a click opens the right app. The profile's helper reports the profile's notification setting. A TCC grant and the Keychain "Always Allow" stay after the default app is replaced by a newer build. Answer and record Q3, Q10, Q11 and Q12, on macOS 14, 15 and 26. If Q3 fails, change to option a before slice 2. |
| 2. Profile Manager | The "Orca Profile Manager" app and Profile Manager mode. UI from the approved mocks: list with "Service running / stopped" and "Open", create (name, id, "Copy settings from the default profile"), rename, remove, repair. The top-level "Profiles" menu. The update rule ("Restart all Orca apps to update", `templateKey` rebuild). | A profile is created, renamed, removed and repaired from the Profile Manager. An update of the default app restarts the running profiles, and their grants stay. |
| 3. Icons | TypeScript `ref-match` and the character badge; then style selection, uploaded badge, uploaded full icon; `.icns` writer; golden tests against dock-icon-badger output. | The default icon matches the Python `ref-match` output within the limit. |
| 4. CLI | `--profile` and `ORCA_PROFILE`, `orca profiles list`, `orca open` per profile, serve fixed to the default profile. | `orca --profile work chat list` reads the "work" profile. `orca --profile work serve` refuses. |
| 5. URL | The Profile Manager as the `orca:` handler, the two modes, the chooser, forwarding of every `orca:` URL. | An `orca:` link opens in the selected profile, or only the chooser shows. The default app's main window does not open. |

Not in this design: Linux and Windows, a serve for other profiles, a change of id after creation.
