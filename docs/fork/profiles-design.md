# Orca profiles on macOS: high-level design (orca T #35)

## High-level summary

Orca profiles let one Mac run several Orca apps at the same time, like Chrome profiles: each one
has its own windows, Dock icon, notifications and data. Each profile is a small app in
"~/Applications/Orca Profiles" that Orca makes and signs on the Mac. It uses the code of the
installed Orca, so it always runs the same version and needs no update of its own. Profiles are
fully separate: settings, chats, cookies, keys, integration and agent sign-ins, and network ports.
Only git, SSH, the shell, project folders, and the terminal and computer-use permissions are shared.
A Profile Manager inside the Orca app, opened from the Profiles menu, shows each profile as
Running, Running in background or Stopped, creates, edits and removes profiles, and decides which
profile opens `orca:` links. Each profile can run its own background server (`orca serve`) on its
own port (spaced so profiles never collide), and every `orca` command accepts `--profile <id>`. Work starts on the nightly line with a
small prototype that proves that macOS accepts these profile apps.

Status: draft 7. The owner answered every open question (2026-11-20). This is a read-only study. No
code is changed. The UI follows the approved mocks.

**The remaining unknowns (section 10) are settled by the slice-1 prototype, not by more paper review.**

Code references are `path:line` on `upstream-stable` (upstream v1.4.259). "(fork)" means branch
`dlux/fork-setup`. "(nightly)" means branch `nightly/fork-setup`. "Measured" means a check on an
installed fork build (Electron 43.8.7), not a code reference.

**Where it is built** (owner): on the nightly line first (`nightly/profiles`, on top of
`nightly/fork-setup`). The stable line gets it with the first stable release that contains it. All
names come from `FORK_IDENTITY`, so nightly profiles are listed under "Orca Nightly Profiles" and
link to the nightly app, and stable profiles under "Orca Profiles".

## Summary

- A profile is a **thin app bundle**, as Chrome makes for its web-app shims. It has its own
  `Info.plist` (bundle id, name, profile id), icon, main executable, small helper executables and
  Electron helper apps. The large parts (the frameworks, `app.asar` and the other resources) are
  symbolic links into the default Orca app. Orca signs it ad hoc on the Mac. No Developer ID key is
  necessary.
- Each profile gets a separate bundle id, so it gets separate notifications, a separate Dock icon
  and separate Dock badges.
- The thin bundle does not change when the default app updates with the same Electron version. Its
  ad-hoc signature, and the TCC and Keychain grants that depend on it, stay. After an Electron
  upgrade, Orca rebuilds the thin bundle, and each grant is asked for once more.
- Supporting evidence: another Electron app on the owner's Mac already runs a second profile made
  the same way (a thin copy with links and its own data folder). It finds all its parts and runs.
- **Complete isolation** (owner): each profile has its own data, cookies, Keychain key, `~/.orca`
  folder, hook scripts, agent config folders (agent sign-ins) and ports. Git, SSH, the shell and
  project folders stay shared. Two parts share their TCC permissions with the default app: the
  terminal host (owner: option H2) and `Orca Computer Use.app`.
- `orca serve` runs **one server per profile** (owner), on the profile's own port (spaced so
  profiles never collide). Each profile can have its own serve service. On the Electron runtime, a
  profile's serve runs from the profile's own executable, so it has the profile's identity. On the
  `orcad` runtime it keeps the default app's TCC identity (section 6).
- The **Profile Manager** is a small app inside the default app's bundle (owner). It lists, creates,
  edits and removes profiles, and handles `orca:` links.
- If slice 1 shows that macOS or Electron refuses the thin bundle, the only fallback is a full APFS
  clone of the default app (section 1, option a).

## 0. What Orca has today

| Fact | Evidence |
| --- | --- |
| The single-instance lock and the shared profile lock are per userData. | `src/main/startup/profile-startup/single-instance-lock.ts:20-29`, `desktop-profile-instance-lock.ts:22` |
| The CLI finds the app through `<userData>/orca-runtime.json` (pid, socket, token). | `src/shared/runtime-bootstrap.ts:17-23,42-45`, `src/cli/runtime/metadata.ts:11-31` |
| The runtime socket is per userData. | `src/main/runtime/rpc/server/runtime-rpc-socket-metadata.ts:58-76` |
| The main process puts its userData in `ORCA_USER_DATA_PATH`. A packaged macOS terminal inherits it, gets the app's `bin` folder first in `PATH`, and does not get `ORCA_CLI_COMMAND`. So `orca` in a terminal of profile X already talks to X. | `src/main/startup/configure-process.ts:254`, `src/main/ipc/pty/host-env/assembly.ts:295-301` |
| `orca open` for another userData starts a second instance of the same bundle (`open -n … --user-data-dir`). | `src/cli/runtime/launch.ts:110-116` |
| The serve service (LaunchAgent) is per userData. | `src/cli/runtime/serve-service-unit.ts:52-54,68-71` |
| Serve refuses a userData that an Orca process already runs. | `src/cli/runtime/serve-electron-preflight.ts:63-77` (message at `:67`) |
| The desktop app refuses a userData that a serve (`orcad`) holds: "Orca could not start". | `src/main/startup/main-process-preflight-failure.ts:10-19`, `desktop-profile-instance-lock.ts:22-35` |
| The serve LaunchAgent restarts after an unsuccessful exit, at most every 10 s. | `src/cli/runtime/serve-service-unit.ts:127-133` |
| `orca serve` starts the executable of the app that holds the CLI, with `--user-data-dir` and `--serve`. | `src/cli/runtime/launch.ts:204-231` |
| Electron sets the Keychain Safe Storage name in `PostCreateMainMessageLoop`, after the main script starts. So a synchronous `app.setName()` before `ready` selects the item. | Electron `shell/browser/electron_browser_main_parts.cc:646-690` |
| Each desktop instance has its own WebSocket endpoint, pairing identity and saved fallback port. | `src/main/runtime/rpc/server/runtime-rpc-lifecycle.ts:135-146` |
| Upstream has in-app "Orca profiles": several profiles in one userData, one active at a time, UI hidden behind `ORCA_MULTI_PROFILE_UI`. | `src/main/orca-profiles/profile-storage-paths.ts:11-13,35-49`, `profile-ui-scope.ts:2-3`, `src/shared/orca-profiles.ts:6-7` |
| The fork identity is set at build time. The nightly build changes it with `sed` in the release commit. | `src/shared/fork-identity.ts` (fork, nightly), `config/scripts/fork/build-release.sh:193-206` (nightly) |
| The main executable is a 53 KB loader. It imports only `ElectronMain`, `ElectronInitializeICUandStartNode` and `electron::fuses::IsRunAsNodeEnabled` from `@rpath/Electron Framework.framework`, with `LC_RPATH @executable_path/../Frameworks`. | measured (`otool -L`, `otool -l`, `nm -u`) |
| Electron finds its helpers as `Frameworks/Electron Helper*.app`, then `Frameworks/<CFBundleName> Helper*.app`. `process.resourcesPath` is `<main application bundle>/Contents/Resources`. | measured (Electron 43.8.7) |
| The asar integrity fuse is off, so Electron does not check `ElectronAsarIntegrity` in `Info.plist`. | measured: fuse bytes `101100011` (position 5, `EnableEmbeddedAsarIntegrityValidation`, is 0) |
| The terminal host `Contents/Helpers/Orca Agents.app` has the app's bundle id. Orca copies it per userData and checks the copy against the running app's designated requirement. | `src/main/daemon/executable-host/macos/macos-daemon-bundle.ts:79-116` (fork) |

Name clash: upstream's in-app profiles are the "one active profile" model that the ticket rejects.
This design calls ours "app profiles" in code and "Profiles" in the UI. The upstream switcher
stays hidden. Each app profile has its own upstream profile index inside its own userData.

## 1. What a profile app is on disk

| Option | Bundle id that macOS sees | Notifications, Dock, badges | Disk | After an update of the default app | Verdict |
| --- | --- | --- | --- | --- | --- |
| T. **Thin bundle**: own `Info.plist`, icon, executables and helper apps; links to the frameworks and resources; ad-hoc signed | the profile's | separate | about 2 MB | not changed while the Electron version stays: same signature, grants stay. Rebuilt at an Electron upgrade. | **Recommended** (owner: "do it the Chrome way") |
| a. APFS clone of the default app, changed `Info.plist` and icon, signed again | the profile's | separate | about 0 until the default app updates | cloned and signed again at each update: grants are lost each time | The only fallback if slice 1 fails for T |
| b. Stub `.app` that starts the Orca executable with `--user-data-dir` | Orca's: a process belongs to the bundle that holds its executable | shared with the default app | ~100 KB | not changed | Rejected: fails the notification requirement |
| b0. `open -n` on the same app (what `launch.ts:110-116` does today) | Orca's | shared: one settings entry, two Dock tiles with the same icon | 0 | not changed | Rejected: same reason |
| c. Chrome's full app-shim model (the shim process owns the Dock tile; the browser process draws the windows into it) | the shim's | separate | small | not changed | Not possible: Electron cannot draw windows into another process |

### How Chrome does it, and what carries over

Chrome makes a small shim bundle for each web app. The shim loads `Google Chrome Framework.framework`
from the installed Chrome. Chrome signs each shim ad hoc on the Mac to give it its own identity
(Chromium feature `kUseAdHocSigningForWebAppShims`; Edge policy `AdHocCodeSigningForPWAsEnabled`
says that without it all web apps share one identity). Chrome's shim finds the framework at run
time. Electron finds `Contents/Frameworks` and `Contents/Resources` from the main bundle. So the Orca
thin bundle puts links at those places. The identity part (a small own bundle, signed ad hoc on the
Mac, not changed at most updates) is the same as Chrome's.

### Layout (option T)

```
~/Applications/Orca Profiles/Orca - Work.app/Contents/
  Info.plist                          own (table below)
  PkgInfo                             copy
  MacOS/<executable>                  copy of the default app's 53 KB main executable
  MacOS/orca-notification-status      copy of the profile variant of the helper (below)
  MacOS/orca-keyboard-layout          copy
  MacOS/orca-process-footprint        copy
  Frameworks/                         real folder
    <name> Helper.app                 copy (232 KB, release signature kept)
    <name> Helper (GPU).app           copy
    <name> Helper (Plugin).app        copy
    <name> Helper (Renderer).app      copy
    Electron Framework.framework      APFS clone (cp -c); a link stops the helpers (section 12, U4)
    Mantle.framework, ReactiveObjC.framework, Squirrel.framework   links, as above
  Resources/icon.icns                 own icon
  Resources/<each other entry>        link -> <default app>/Contents/Resources/<entry>
  _CodeSignature/CodeResources        ad-hoc seal
```

- **No executable is a link.** `codesign --force` on the bundle can follow a link to an executable
  and sign the default app's file. So every executable in `MacOS` is a copy.
- **The Electron helper apps are copies.** A helper that starts through a linked `Frameworks` folder
  resolves its real path into the default app. Chromium then finds the default app as the main
  bundle, takes its bundle id, and builds a Mach port rendezvous name that differs from the browser
  process's name, so renderers probably cannot start (Chromium `electron_library_main.mm:33-35`,
  `main_application_bundle.mm:27-53`, `base_paths_apple.cc:38`, `mach_port_rendezvous_mac.cc:46,155,239`).
  A helper copy inside the profile finds the profile as its main bundle, so the name matches. Its
  `process.resourcesPath` is the profile's `Contents/Resources`, which the links serve.
- **`Resources`** is a real folder, because the icon must be in it. It holds one link for each
  top-level entry of the default app's `Resources` (73 entries today: `app.asar`,
  `app.asar.unpacked`, `bin`, the `.lproj` folders, `orcad-template`, `Orca Computer Use.app`, …).
- **The seal.** The links point to fixed paths, so their targets do not change when the default app
  updates. Measured: `CodeResources` records each file link as its target path, and the cdhash was
  the same after the default bundle was replaced. Slice 1 dumps `CodeResources` after signing and
  after an update of the default app, and checks this again for the framework links.

| `Info.plist` key (start from a copy of the default app's file; edit with `plutil`, which reads XML and binary files) | Value | Why |
| --- | --- | --- |
| `CFBundleIdentifier` | `<default appId>.profile.<id>`, with `_` changed to `-`. Example: `com.stablyai.orca.dlux.profile.work` | A bundle id allows only `A-Z a-z 0-9 . -`. The prefix keeps the `com.stablyai.orca.*` checks working (`src/shared/fork-identity.ts:4` (fork)). |
| `CFBundleDisplayName` | the profile name | |
| `OrcaAppProfileId` (new) | `work` | The main process reads it at start. |
| `CFBundleURLTypes` | removed, **from slice 1** | Only the Profile Manager dispatches `orca:` links (section 5). A profile that claims the scheme could take the links. |
| `CFBundleDocumentTypes` | not changed | The default app registers `md`, `markdown`, `mdx`, `csv` and `tsv` as an "Alternate" editor (`config/electron-builder.config.cjs:611-626` (fork)). Each profile shows in "Open With" (owner: "exactly what we want"). |
| `ElectronAsarIntegrity` | removed | The fuse is off (section 0). The value would be out of date after each update. If upstream turns the fuse on, the plist must carry the hash, and it changes at each update. |
| `CFBundleName`, `CFBundleExecutable`, usage descriptions, `LSEnvironment`, `NSPrincipalClass` | not changed | Electron finds `<CFBundleName> Helper*.app` from the bundle name. TCC prompts read the usage descriptions of the profile bundle. |
| `CFBundleShortVersionString` | not changed | It stays the version of creation. Finder shows that version (owner: accepted). `app.getVersion()` reads `package.json` in `app.asar`, which follows the default app. |

The `.app` file name is the name that Finder and the Dock show.

### What Electron and macOS must accept (slice 1 tests each item)

| Item | Expected or measured | If it fails |
| --- | --- | --- |
| `codesign` with links that point outside the bundle | Measured: signing passes and `codesign --verify` passes; `codesign --verify --strict` fails. Slice 1 checks that launch, notifications and TCC accept such a bundle on macOS 14, 15 and 26. | option a. ("Sign first, then add the links" is not a fallback: then `codesign --verify` fails.) |
| dyld resolves `@executable_path/../Frameworks/Electron Framework.framework` through the link | Measured: yes. | option a |
| Library validation | Measured: a hardened-runtime ad-hoc executable cannot load a framework of another Team ID. So never sign with `--options runtime`. Without the hardened runtime, the ad-hoc main executable loads the release framework. | — |
| Helper processes start and connect (Mach port rendezvous) | Expected with the helper copies above. | option a |
| `process.resourcesPath` | `<profile>/Contents/Resources`. Each entry resolves through its link. 164 lines in `src/main` use `resourcesPath`. Slice 1 runs a smoke test: terminal, agent, browser, computer use, `orcad` template, `orca` CLI. | Fix the code that compares real paths. |
| The `orca` launcher in `Resources/bin` | `cd -P` in the launcher resolves the `bin` link, so the CLI runs from the default app. `ORCA_USER_DATA_PATH` still points it to the profile. | — |
| Notification helper identity | The profile variant reports the profile's notification settings (below). | Report "unknown" for the profile. |
| A thin copy with links runs | Supporting evidence: another Electron app on the owner's Mac runs a second profile made the same way (a thin copy with links and its own data folder). | — |
| Keychain prompt | An ad-hoc app that opens an item that a Developer-ID app made can ask for the login password, not only "Always Allow". With per-profile items (section 3) the profile makes its own item. Slice 1 records the prompt. | Accept the prompt once. |

**Notification helper.** `config/scripts/native-build/macos/build-notification-status-macos.mjs:2,25`
(fork) embeds the default app's `CFBundleIdentifier` in `__TEXT,__info_plist`. `codesign -i` changes
the signature identifier but not that embedded section. So the release also builds a profile
variant of `orca-notification-status` with no embedded `Info.plist`. It ships in the default app as
`Contents/Resources/profile-template/orca-notification-status` (it does not run from there; macOS 26
aborts notification helpers that run from `Resources`, `config/electron-builder.config.cjs:665`
(fork)). The profile gets a copy in its own `Contents/MacOS`, signed with `-i <profile bundle id>`.
Slice 1 checks it: turn the profile's notifications off in System Settings; the profile's helper
reports `denied`, and the default app's helper still reports `authorized`.

### Terminal host (`Orca Agents.app`)

The terminal host keeps terminals alive when the app restarts. It is 128 MB: a 116 MB Node
executable in `Contents/MacOS` and about 12 MB of daemon code in `Contents/Resources/daemon`
(`daemon/out/main/daemon-entry.js` and others). The daemon code changes with every release. Its
bundle id is `com.stablyai.orca.dlux`, and it has 10 entitlements (measured).

`materializeMacDaemonBundle` copies the host into a per-userData folder. It verifies the copy with
`codesign --verify --strict -R=<designated requirement of the running app>`
(`src/main/daemon/executable-host/macos/macos-daemon-bundle.ts:103-115` (fork)). In a profile this
fails:

- For an ad-hoc app, `codesign -d -r-` prints `# designated => cdhash H"…"`. The code looks for a
  line that starts with `designated => ` (`:53-71`), so it throws.
- A requirement `cdhash H"…"` of the profile's main executable cannot match another binary.

Then `fallBackToFork` runs (`src/main/daemon/executable-host/macos/macos-daemon-launchd.ts:148-151`
(fork)), and terminals do not survive a restart of the profile.

**Owner decision: H2** ("Ok, let's do it"). The host is not in the profile bundle. Every profile
uses the release host of the default app. Orca makes the per-userData copy from it, and checks the
copy against the host's own Developer ID requirement. Terminals survive a profile restart. The
terminal processes have the default app's TCC identity, so all profiles share the terminal
permissions. Data, keys and `~/.orca` stay isolated, because the host reads them from the
environment of each profile (section 3).

Not selected: H1 (a per-profile copy of the host, signed ad hoc: isolated terminal permissions, but
about 120 MB per profile and new TCC prompts at each release, because the daemon code changes every
release) and H3 (no change: terminals do not survive a profile restart).

**Code changes:**

- `macos-daemon-bundle.ts:83-84` (fork): the source host. In a profile, take
  `<defaultAppPath>/Contents/Helpers/Orca Agents.app` (from the registry or the marker), and call
  `realpath(source)` before `cloneMacTree`. `cloneMacTree` runs `cp -cR`
  (`src/main/filesystem/macos-tree-clone.ts:12-17` (fork)), which copies a link as a link. A "stable
  copy" that is a link would point back into the live default app, and `--verify -R` would follow
  it and pass.
- `macos-daemon-bundle.ts:103-110` (fork): in a profile, check the copy against the source host's own
  requirement (`codesign -d -r-` of the source host), not against the running app's.
- `macos-daemon-launchd.ts:83` (fork): `AssociatedBundleIdentifiers` keeps the default app's id,
  because the host is the release host and its TCC identity is the default app's.

### Changes in the main process

- Before `configureDevUserDataPath` (`src/main/startup/main-process-preflight.ts:204`; the fork pin
  is at `configure-process.ts:223-225` (fork)): find the profile, in every mode (desktop, `--serve`,
  headless `orcad`). Each profile's userData holds a marker file `orca-app-profile.json` with the id
  (written at creation). The marker is necessary because serve and `orcad` can start with
  `--user-data-dir` from another executable. Resolve in this order:
  1. `OrcaAppProfileId` in the app's own `Info.plist`: a profile. Read the marker from
     `~/Library/Application Support/Orca Profiles/<id>/`, or from `--user-data-dir` when it is given.
  2. Else the marker in the `--user-data-dir` folder (or `ORCA_USER_DATA_PATH`): a profile.
  3. Else: not a profile.

  Never read the marker from the default userData: it is not set yet. Stop with an error only when
  both ids exist and differ. With a profile: set userData to
  `~/Library/Application Support/Orca Profiles/<id>`, call `app.setName('orca-<id>')` synchronously
  (the Keychain item, section 3; Electron reads the name later, section 0), and set `ORCA_HOME_DIR`.
- Read the bundle id and name at runtime, not from the build-time `FORK_IDENTITY`, in these places:
  `dev-instance-identity.ts:59-71`, `src/main/ipc/notification-system-settings-link.ts:4-10`,
  `src/main/window/createMainWindow.ts:128`, the renderer title bar (all fork). One helper,
  `runtimeAppIdentity()`, serves them all.
- `src/main/macos-permissions/macos-tcc-prompt-watch.ts:12-21` (fork) has a closed set of bundle
  ids. Change it to a prefix match on `com.stablyai.orca.`, so it accepts each profile and the
  helper ids (`com.stablyai.orca.dlux.helper.*`).
- Turn the updater off in a profile: the gate at `src/main/updater/lifecycle/updater-setup.ts:144` (fork).

## 2. Signing

Owner decision: sign ad hoc on the Mac, as Chrome does. The user needs no Developer ID key.

```sh
for f in orca-notification-status orca-keyboard-layout orca-process-footprint; do
  codesign --force -s - -i <bundle id> "<profile>/Contents/MacOS/$f"
done
codesign --force -s - -i <bundle id> --entitlements <ent> "<profile>"
lsregister -f "<profile>"
```

- `<ent>` is the entitlements of the default app (`codesign -d --entitlements`). All of them are
  allowed in an ad-hoc signature.
- No `--deep`. The Electron helper copies keep their release signatures (unknown U6 has the case
  where they must change). The linked frameworks keep theirs.
- No `--options runtime` (library validation, section 1).
- `lsregister` is the Launch Services tool in `CoreServices.framework`.

**The release signature.** An installed fork build has a Developer ID signature with no hardened
runtime and no notarization (measured: `codesign -dv` shows `flags=0x0`; `spctl` shows "Unnotarized
Developer ID"). The fork's release steps build without `ORCA_MAC_RELEASE` (`docs/fork/PATCHES.md`,
"Release steps"), so `hardenedRuntime` and `notarize` are off (`config/electron-builder.config.cjs:105,645,647`
(fork)). electron-builder signs with an identity that it finds in the keychain of the build
machine, and signs ad hoc when there is none (the same rule for the Computer Use helper:
`:828-832`). Users do not have the key. The thin bundle does not need it.

| Grant | What macOS stores for an ad-hoc app | Thin bundle (T) | Clone (a) |
| --- | --- | --- | --- |
| TCC (Accessibility, Screen Recording, Automation, Files and Folders, Camera, Microphone) | the cdhash of the main executable. The code directory includes the hashes of `Info.plist` and of the seal. | kept at updates with the same Electron version; asked again after an Electron upgrade | lost at each update |
| Keychain item ("Always Allow") | the cdhash | as TCC | lost at each update |

- **Quarantine and notarization.** Orca writes the bundle itself, so it gets no
  `com.apple.quarantine`. Gatekeeper does not check it, and it needs no notarization.
- **TCC.** Each profile asks once for each service. `Orca Computer Use.app` (linked) keeps its own
  id and grants, and all profiles share it in v1. A later per-profile copy is possible, signed ad
  hoc, as a terminal-host copy would be.
- **App Management (macOS 13 and later).** A change to an app bundle can show "Orca would like to
  modify apps". A rebuild writes a new bundle to a temporary path and swaps it in with a rename.
  Slice 1 tests it.

## 3. Data and isolation

Owner decision: "completely separate cookies, keys, etc. for each profile".

| Item | Where | Scope | Work |
| --- | --- | --- | --- |
| Registry | `~/Library/Application Support/Orca Profiles/profiles.json` | all profiles | new |
| Profile userData: settings, chats, terminal daemon, worktree records, browser sessions and cookies, upstream in-app profiles, `orca-runtime.json`, socket, pairing identity, WebSocket port | `~/Library/Application Support/Orca Profiles/<id>/` | one profile | none: all is keyed by userData |
| Profile Manager userData (Electron needs one; no runtime data) | `~/Library/Application Support/Orca Profiles/.manager/` | the Profile Manager | new |
| Default profile userData | `~/Library/Application Support/orca` (shared with official Orca: fork `docs/fork/PATCHES.md` Part 1) | default profile | none |
| Keychain Safe Storage item | default: "orca Safe Storage". Profile: "orca-<id> Safe Storage" | one profile | pre-ready `app.setName('orca-<id>')` in a profile only. userData is pinned before, so the name does not move it (`dev-instance-identity.ts:16-19` (fork) keeps packaged builds from a pre-ready rename; profiles are the exception). |
| `~/.orca`: integration credentials (Linear, Jira, Bitbucket, API keys), MiniMax cookies, Claude theme sync, agent hook scripts and their install lock, host terminal policy, keybindings | default: `~/.orca`. Profile: `<userData>/orca-home` | one profile | an `ORCA_HOME_DIR` override in one helper, used at every site. Searches on `upstream-stable`: `git grep -l -F "join(homedir(), '.orca'" -- src ':!*.test.*'` finds 14 files (for example `src/main/linear/accounts/linear-credential-paths.ts:7-9`, `src/main/credentials/encrypted-api-key-file-store.ts:42-44`, `src/main/agent-hooks/installation/scripts/managed-hook-script-path.ts:6`). Sites that take a `home` parameter: `src/main/agent-hooks/installation/locking/managed-hook-install-lock.ts:52`, `src/main/daemon/admission/host-terminal-policy.ts:27`, `src/main/keybindings/keybinding-file.ts:29`. All literals: `git grep -l -F "'.orca'" -- src ':!*.test.*'` finds 30 files to review (78 with tests). The UI label `~/.orca/keybindings.json` (`src/renderer/src/components/settings/shortcuts/ShortcutsPane.tsx:341`) shows the profile's path. `.orca` paths on remote hosts (SSH, WSL) do not change, on purpose: a remote host has no profile. |
| Hook commands in agent configs | `"${HOME-}/.orca/agent-hooks/<name>.sh"`: `git grep -n -F '${HOME-}/.orca' -- src ':!*.test.*'` finds `src/main/agent-hooks/installation/commands/runtime-home-hook-command.ts:26,46` and the second Codex form `src/main/codex/hooks/definitions/codex-hook-command-form.ts:23` | one profile | each command reads `${ORCA_HOME_DIR:-$HOME/.orca}`; profile terminals export `ORCA_HOME_DIR` |
| Agent configs and sign-ins (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`) | default: the agents' own defaults. Profile: under `<userData>/orca-home/agents/` | one profile (owner: "that's the whole point of the profiles") | profile terminals export the three variables. Orca already routes Claude config homes (`src/main/claude-accounts/profiles/claude-profile-homes.ts`). |
| Terminal host and its TCC identity | the default app's release host (H2, section 1) | shared | slice 1 |
| Serve and WebSocket port | the registry (`port`: 6800, 6832, …), set in the profile editor | one profile | section 4 |
| Worktree folders | where the settings of each profile put them | shared file system; each profile keeps its own records | none |
| Git, SSH, the shell, project folders | home folder | **shared on purpose** | none |
| `orca` CLI link | the user's PATH | one link, from the default app | none |

The profile folders are outside the `orca` folder, so official Orca never sees them.

**New profile.** It starts empty and shows onboarding. At the bottom of the New profile dialog, a
dropdown "Copy settings from:" has the values "No copy" (the default) and the name of each existing
profile, the default profile too (owner). It copies the settings only, not chats, projects,
worktrees, sign-ins or encrypted values. The copy seeds the new profile's state through the same
start path that upstream uses for a new in-app profile (`initializeNewOrcaProfileState`,
`src/main/orca-profiles/storage/new-profile-state.ts:17-40`), with the selected profile's settings
in place of the defaults.

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
      "port": 6800,
      "templateKey": "<hash of the parts in section 7>",
      "createdAt": 1763600000000
    }
  ]
}
```

- `urlHandler.mode` is `ask`, or `profile` with a `profileId`. The default profile is implicit,
  with id `default` and the default port 6768 (`DEFAULT_WS_PORT`,
  `src/main/runtime/rpc/server/runtime-rpc-pairing-types.ts:21`). Other `icon.kind` values: `image`
  (an uploaded badge) and `file` (an uploaded full icon).
- **Writers.** The Profile Manager and the local `orca profiles` commands write the file. Each one
  takes a lock file next to it, and writes a temporary file and a rename. The profiles read the file
  and watch it with `fs.watch`.
- **Port** (owner: "a parameter in the profile editor"). Each profile has its own port for the
  desktop WebSocket endpoint and for `orca serve`. The New profile and Edit dialogs show it.
  - **Today.** The packaged desktop does not pin 6768 (`preferPinnedWsPort` and
    `requirePinnedWsPort` default to false, `src/main/runtime/rpc/server/runtime-rpc-state.ts:124-126`).
    When the port is taken, it tries a fallback ladder of the next 31 ports (`port+1` … `port+31`,
    without 6769), then a random port (`src/main/runtime/rpc/transports/websocket/ws-fallback-port-store.ts:7-20`).
    6769 is reserved for `pnpm dev` (`DEV_PINNED_WS_PORT`, `:8-9`). So the default app uses 6768 to 6799.
  - **Profile ports** start at 6800 and are 32 apart: 6800, 6832, 6864, … The default for a new
    profile is the first free value in that series. So no profile's port or fallback ladder overlaps
    another profile's or the default app's.
  - **Validation** in the editor: a number from 1024 to 65535; not the port of another profile; not
    inside the ladder of another profile or of the default app (6768 to 6799); a warning (not an
    error) when another process listens on it now.
  - **Desktop:** the profile app passes its port as the preferred `wsPort`
    (`runtime-rpc-lifecycle.ts:135-146`) and keeps the normal fallback. It does not set
    `requirePinnedWsPort`, so a taken port never stops the app.
  - **Serve:** only `orca --profile <id> serve` pins the port, with `--port`. A taken port stops
    serve with an error, as today (`PinnedPortUnavailableError`).
- **States** (owner). Each row of the list shows one of:
  - "Running": the profile app runs;
  - "Running in background": the profile's serve service runs and the app does not (also after the
    user quits the app and macOS shows the service as running in the background);
  - "Stopped": neither runs.

  The Profile Manager reads them from the app's `orca-runtime.json` (its pid, tested with signal 0,
  as `runtime-rpc-socket-metadata.ts:43-47` does) and from `orca --profile <id> serve service
  status` (`src/cli/specs/serve.ts:109-116`).
- **Serve and app exclude each other** in both directions: serve refuses a running app (section 0),
  and the app refuses a profile that a serve (`orcad`) holds ("Orca could not start",
  `main-process-preflight-failure.ts:10-19`). One mechanism, in the profile app itself:
  - At start, before it takes the profile lock (before `acquireDesktopProfileLockOrExplain`), the
    app checks for its own serve LaunchAgent. If the job is loaded, the app runs
    `launchctl bootout gui/<uid>/<label>` and waits until the profile lock is free.
  - When it quits normally, the app runs `launchctl bootstrap gui/<uid> <plist>` for the job that it
    stopped. The row changes from "Running" to "Running in background".

  So every path that starts the app works the same: the Dock, Finder, the Profiles menu, an
  `orca:` forward, `orca open` and "Open" in the Profile Manager. After a crash of the app, the
  service stays stopped until the next normal quit; the row shows "Stopped" and offers "Start
  service".
- **Open.** Each row has "Open", the default profile's row too: `open -b <bundleId>`. It brings the
  profile to the front with a window, or starts it.
- **Messages.** Use the profile's unix socket and token from `orca-runtime.json`, as the CLI does
  (`src/cli/runtime/metadata.ts:11-31`). No new port.
- **Profiles menu** (owner): a top-level "Profiles" menu in the menu bar of every profile, of the
  default app and of the Profile Manager. It lists each profile with its state, a check mark on the
  current one, and "Profile Manager…". A click on a profile does the same as "Open". It is built in
  `src/main/menu/register-app-menu.ts` (fork) as its own top-level menu.

### The Profile Manager app

Owner decision: the Profile Manager is an app inside the default app's bundle, as Xcode keeps
Simulator and Instruments inside its own bundle. It is not part of Settings.

- **Where:** `<default app>/Contents/Applications/Orca Profile Manager.app`. Finder does not show
  it, except with "Show Package Contents". The user opens it with "Profiles > Profile Manager…" in
  any Orca app, or with `orca profiles manager`.
- **Build:** the release builds it and signs it with the release identity, as its own step before
  the outer bundle is sealed. `Contents/Applications` is sealed as data, not as nested code, so the
  outer signature does not sign the nested app by itself. Orca does not sign it on the Mac. It
  updates with the default app.
- **Shape:** its own `Info.plist` (bundle id `<default appId>.profile-manager`,
  `OrcaAppRole = profile-manager`, `CFBundleURLTypes` for `orca:`), its own icon, its own copy of the
  main executable and of the four Electron helper apps (the helper rule of section 1). Its
  `Frameworks/*.framework` and `Resources/*` entries are relative links to the outer bundle.
  Measured: checked alone, the nested app fails `codesign --verify --strict` (its links point out of
  the nested bundle), and the outer app passes `codesign --verify --deep --strict` (the links stay
  inside the outer bundle). Slice 3 also checks Gatekeeper on a quarantined download of the whole
  app, so that Gatekeeper assesses the nested app too.
- **Alternative location:** `Contents/Helpers/Orca Profile Manager.app`, if Gatekeeper or Launch
  Services treat `Contents/Applications` badly.
- **Mode:** it starts Orca in Profile Manager mode: the main process opens only the Profile Manager
  window. It starts no runtime, no agents and no updater. Its userData is
  `~/Library/Application Support/Orca Profiles/.manager/`. It is independent of the profiles, and
  works when no profile runs.
- **`orca:` handler:** Launch Services does not always register an app inside another app's bundle
  by itself. So the default app, at each start, runs `lsregister -f` on the nested app and sets the
  nested bundle id as the `orca:` handler (`LSSetDefaultHandlerForURLScheme`). Until that is done,
  the default app can still get an `orca:` link: it then passes the link to the Profile Manager
  (`open -a <nested app> <url>`) and does not open its own main window. Slice 3 checks that Launch
  Services opens `orca:` links in the nested app (unknown U8).

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
- **Design.** The Profile Manager app is the handler. The default app sets it as the handler at
  each start (section 4), on macOS too (extend `orca-protocol-registration.ts:12`, which today
  registers only on Windows).
  Profile apps do not claim the scheme (section 1). The default app keeps its claim, because its
  bundle comes from the release.
- **Dispatch.** The Profile Manager takes **every** `orca:` URL:
  - mode `profile` with profile X (or the default profile): forward the URL to X, with no window;
  - mode `ask`: show only the chooser window, with the profiles (running ones first) and an
    "Always use this profile" box that sets the mode. It never opens the default app's main window.
  - If the Profile Manager started only for this link, it quits after the forward.
- **Forward.** `open -a <appPath> <url>` sends the URL event to the running app, or starts the app
  and then sends it. The `open-url` handler is registered before `ready` (`index.ts:150`), so a cold
  start gets it. Slice 1 verifies that Electron fires `open-url` for a scheme that the bundle does
  not claim (unknown U2). Fallback: a new runtime call over the target's socket that passes the
  URL to the same handler; for a stopped target, start it with `open -b` first, wait for
  `orca-runtime.json`, then make the call.
- **Target.** The target still filters with `isRoutedOrcaDeepLink`, so a forwarded
  `orca://pair?code=…` is dropped. Design: the target accepts every `orca:` URL in `open-url`. It
  routes skill-share and plugin-install links as today, and opens the "add remote host" dialog with
  the code filled in for a pairing link. Other `orca:` URLs show "This link is not supported".

## 6. CLI

**Today.** `orca` uses `ORCA_USER_DATA_PATH`, else the platform default
`~/Library/Application Support/orca` (`src/cli/runtime/metadata.ts:42-58`,
`src/cli/runtime/launch-user-data-path.ts:11-21`). Then it reads `orca-runtime.json`. A packaged
macOS terminal inherits `ORCA_USER_DATA_PATH` from the main process (`configure-process.ts:254`) and
gets the app's `bin` folder first in `PATH`; it does not get `ORCA_CLI_COMMAND`
(`src/main/ipc/pty/host-env/assembly.ts:295-301`). So `orca` in a profile terminal talks to that
profile with no new code.

**Flag clash.** `--profile` is already the browser profile flag
(`src/cli/specs/browser-basic.ts:232-275`, `src/cli/specs/browser-advanced.ts:10`,
`src/cli/browser/browser-tab.ts:80`). `orca profile state … --profile-id` is upstream's in-app
profile (`src/cli/specs/profile-state.ts:6-19`).

**Design** (owner confirmed).

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
| `orca serve` | **one server per profile** (owner), on the profile's own port from the registry (section 4). On the `orcad` runtime (`resolveLocalServeRuntime`, `src/cli/runtime/launch.ts:171-195`), serve runs the Node server from the default app's resources, and keeps the default app's TCC identity. It finds the profile only through the marker file, and then applies the profile's `ORCA_HOME_DIR`. It does not use the Electron Safe Storage item: `orcad` has its own host keys (`src/main/credentials/saved-credential-readability.ts:5`). `orca --profile work serve` serves "work"; without `--profile`, the default profile. Each profile has its own port and pairing identity, because both are per userData (`runtime-rpc-lifecycle.ts:135-146`). A profile's serve starts `<profile appPath>/Contents/MacOS/<executable>` (the `appPath` from the registry), not the default app's executable that `launch.ts:204-231` starts today. On the Electron runtime, serve then has the profile's Keychain item, `~/.orca` folder and TCC identity. The main process also finds the profile from the marker file in userData (section 1). The existing rule stays: serve refuses a profile that an Orca process already runs (`src/cli/runtime/serve-electron-preflight.ts:67`, the per-userData lock at `desktop-profile-instance-lock.ts:22`). |
| `orca serve service install/status/uninstall` | one LaunchAgent per profile. The label and log already carry a hash of the userData (`serve-service-unit.ts:52-54,68-71`). The unit's command runs the profile's executable, as above. |
| `orca profiles list [--json]` (plural, so it does not clash with `orca profile state`) | all profiles: id, name, app path, service status |
| CLI registration (Settings > Command line) | only in the default app; hidden in profiles |

## 7. Updates

- The updater is off in a profile app and in the Profile Manager. A profile runs the code of the
  default app through its links, so it follows the default app's version with no update of its own.
- **Restart rule** (owner: acceptable; "The Chrome apps quit in that case, too"). A running profile
  must not see the default app's files change under it: a new framework or a new `app.asar` with an
  old main process can crash it. So:
  - When an update is ready, the default app does not install it while a profile runs. Its update
    card shows "Restart all Orca apps to update".
  - That action quits each running profile (a runtime call over its socket) and stops each
    profile's serve service (`launchctl bootout`). Then it installs the update, starts the default
    app, starts again the services that ran, and then the profiles that ran. Each profile stops its
    own service again when it starts (section 4).
  - `autoInstallOnAppQuit` (`src/main/updater/lifecycle/updater-setup.ts:156` (fork)) stays off while
    a profile runs, so a quit of the default app alone does not install it.
- **When the thin bundle must change.** The Profile Manager stores a `templateKey`: a hash of
  - the Electron version;
  - the release cdhashes of the copied executables: `orca-notification-status` (profile variant),
    `orca-keyboard-layout`, `orca-process-footprint`;
  - the default app's top-level `Resources` names;
  - the `Info.plist` keys that the profile copies;
  - the imports of the main executable (`nm -u`).

  After an update, if the key is different, the next start of the profile rebuilds its bundle (new
  copies, links and plist keys, sign again). This changes the cdhash, so TCC and the Keychain ask
  once more.
  - An Orca update with the same Electron version and the same small executables: no rebuild.
  - An Electron upgrade: the helper copies and the main executable must match the framework, so a
    rebuild and one more set of prompts.
- If the default app moves or is renamed, the links break. There is no "Repair" in v1 (owner): the
  user makes the profile again with the same name. A new profile with the id of an existing data
  folder uses that folder again (section 9).
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

**Automatic id** (from the name):

1. Remove the word "Orca" (any case) and a leading "-".
2. Change each character that is not `A-Z a-z 0-9` to a space.
3. Trim, change to lower case, and join the words with `_`. "Orca - New Profile" becomes `new_profile`.
4. An empty result becomes `profile`. An id in use gets `_2`, `_3`, and so on.

The automatic id is always lower case.

**Edited id.** The user can edit the id in the create dialog.

- Pattern `^[A-Za-z0-9][A-Za-z0-9_]{0,31}$`. An edited id keeps the case that the user types.
- Every id must be unique when case is ignored, because the default APFS volume and bundle ids
  ignore case.
- `default`, `all` and `manager` are reserved.

**Name.** It starts as "Orca - New Profile", then "Orca - New Profile 2", 3, and so on. The name
must be unique, and is also the `.app` file name, so it cannot contain `/` or `:`.

**Rename** changes the name only: rename the `.app`, set `CFBundleDisplayName`, sign again, and
write the registry. The profile must quit first. The id, the bundle id and the userData do not
change. A rename changes the cdhash, so TCC and the Keychain ask once more.

**Recreate.** "New profile" with a name whose id has a data folder already (for example after the
default app moved, or after Remove with "Keep data") uses that folder again. The marker file in it
confirms the id. The dialog says so before it creates the app.

**Change of id after creation** is not in this design. A new bundle id loses the notification
settings, the TCC grants and the Keychain access, and the userData must move.

**Remove** (owner confirmed):

1. Ask the profile to quit (a new runtime call over its socket; else SIGTERM to its pid). Stop and
   remove its serve service, if it has one.
2. Move the `.app` to the Trash.
3. Move the userData folder (with its `orca-home`) to the Trash, unless the user selects "Keep data".
4. Remove the registry entry.
5. Unregister the app from Launch Services (`lsregister -u`), and run `tccutil reset All <bundleId>`.
   Its Keychain item "orca-<id> Safe Storage" stays with "Keep data", else Orca deletes it.
6. If the profile handled `orca:` URLs, set the mode to `ask`.

## 10. Decisions and remaining unknowns

**Decided by the owner (2026-11-20):** the thin bundle, signed ad hoc on the Mac (the Chrome way);
complete isolation, with agent sign-ins per profile; one serve per profile, each with its own port in
the profile editor; the Profile Manager inside the default app's bundle; the states "Running",
"Running in background" and "Stopped"; the "Copy settings from:" dropdown (settings only); terminal
host H2; profiles keep "Open With"; no "Repair" in v1 (recreate with the same name); the old version
in Finder is accepted; all Orca apps restart for an update; `--profile` before the command with
`ORCA_PROFILE`; Remove to the Trash with "Keep data"; the top-level Profiles menu; the TypeScript icon
port; the approved mocks; nightly first. `Orca Computer Use.app` is shared in v1.

**Unknowns that the prototype answers** (U1 to U7 in slice 1, U8 in slice 3). Each has the action if
the answer is no.

| # | Unknown | If no |
| --- | --- | --- |
| U1 | Does macOS 14, 15 and 26 launch a bundle whose links point outside it, and do notifications and TCC accept it? (Signing and `--verify` pass; `--verify --strict` fails.) | Option a (clone), with lost grants at each update. |
| U2 | Does `open -a <app> <url>` deliver `open-url` to a bundle that does not claim `orca:`? | A runtime call over the target's socket. |
| U3 | Does App Management prompt when Orca writes or changes a profile bundle? | Write the new bundle to a temporary path and swap it with a rename; accept one prompt. |
| U4 | Do the helper copies start and connect, and does the smoke test pass through the links (`process.resourcesPath`, terminal, agent, browser, computer use, `orcad` template, CLI)? | Fix the code that compares real paths; else option a. |
| U5 | Are `CodeResources` and the cdhash the same after the default app is replaced by a newer build with the same Electron version, with the TCC grant and the Keychain access kept? | Grants are asked again at each update; tell the owner. |
| U6 | Chromium's peer requirement check for Mach port rendezvous (`kMachPortRendezvousValidatePeerRequirements` is on; its enforcement is off today). If a later Electron turns enforcement on, an ad-hoc browser process with Developer ID helpers can fail. | Sign the helper copies ad hoc too, with ids under the profile's id (sound: the check compares the helpers with the browser process's own requirement, Chromium `process_requirement.cc:447-459`); or turn the enforcement feature off with `--disable-features`, beside `DISABLED_CHROMIUM_FEATURES` (`configure-process.ts`). The `templateKey` rebuild after an Electron upgrade runs the smoke test again. |
| U7 | Does the profile variant of the notification helper report the profile's own setting? Which Keychain prompt does an ad-hoc profile get for its new item? | Report "unknown" for the profile; accept the prompt once. |
| U8 | Slice 3: does Launch Services open `orca:` links in the nested Profile Manager after `lsregister -f` and the handler setting, and does Gatekeeper accept the nested app in a quarantined download? | Move it to `Contents/Helpers`, else to `~/Applications/Orca Profiles/` as a thin bundle. |

## 11. Phased plan

Each slice is one PR on the nightly line (`nightly/profiles`) with its own tests. The product is
done only after slice 2 (isolation).

| Slice | Content | Done when |
| --- | --- | --- |
| 1. Proof | Main process: read `OrcaAppProfileId` and the marker, set userData, runtime identity, updater off, TCC watch prefix match. Release: the profile variant of the notification helper in `profile-template`. Terminal host H2: the source from the default app (real path), the check against the host's own requirement. A hidden local command `orca profiles create <name>`: the thin bundle (copies, links), `Info.plist` by `plutil` (no `CFBundleURLTypes` or `ElectronAsarIntegrity`), ad-hoc signatures, `lsregister -f`, the marker, the registry. | Two profiles run at the same time, each with its own Dock icon and badge, and its own entry in System Settings > Notifications. A notification from each shows its own name, and a click opens the right app. Terminals survive a restart of the profile. U1 to U7 are answered and recorded on macOS 14, 15 and 26. If U1 fails, change to option a before slice 2. |
| 2. Isolation | `ORCA_HOME_DIR` for every `~/.orca` site and the hook commands; the per-profile Keychain item (pre-ready name); per-profile agent config folders (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`). | Two profiles signed in to different Linear, Jira and agent accounts do not see each other's sign-ins, cookies or keys. |
| 3. Profile Manager | The nested "Orca Profile Manager" app (release build) and Profile Manager mode. UI from the approved mocks: list with the three states and "Open" (default profile too), New profile and Edit (name, id, port, "Copy settings from:"), rename, remove, recreate with the same name. The top-level "Profiles" menu. The update rule ("Restart all Orca apps to update": profiles and their serve services; `templateKey` rebuild). U8, and Gatekeeper on a quarantined download of the whole app. | A profile is created, edited, removed and recreated from the Profile Manager. An update of the default app restarts the running profiles and their serve services, and their grants stay. |
| 4. Icons | TypeScript `ref-match` and the character badge; then style selection, uploaded badge, uploaded full icon; `.icns` writer; golden tests against dock-icon-badger output. | The default icon matches the Python `ref-match` output within the limit. |
| 5. CLI and serve | `--profile` and `ORCA_PROFILE`, `orca profiles list`, `orca open` per profile, serve and serve service per profile from the profile's executable on the profile's port, the profile app's own stop and start of its service. | `orca --profile work chat list` reads "work". `orca --profile work serve` serves "work" on its own port, beside the default profile's serve. |
| 6. URL | The Profile Manager as the `orca:` handler, the two modes, the chooser, forwarding of every `orca:` URL, the target's handling of every `orca:` URL. | An `orca:` link opens in the selected profile, or only the chooser shows. The default app's main window does not open. |

Not in this design: Linux and Windows, a change of id after creation, "Repair" of a profile after the default app moves.

## 12. Slice 1 results

Measured on 2026-11-21 on one Mac with macOS 27.2 (build 26B123), Apple silicon. Branch
`nightly/profiles`. macOS 14, 15 and 26 are not tested.

**Test setup.**

- The default app is a local nightly build (`1.4.264-daily.202611181832-dlux.profiles.1`, Electron
  43.8.10). It is not a release build. electron-builder signed the app, its frameworks and its helper
  apps with a local self-signed certificate (no team, no hardened runtime). The terminal host and the
  notification helpers are ad hoc. A release has a Developer ID signature instead. So the profile ran
  ad hoc on code with another identity, as in a release, but not with a Developer ID.
- The build has no `orcad` template, so `orca serve` runs on Electron.
- Two profiles, "Work" and "Home", in a test folder. `ORCA_PROFILES_ROOT` and
  `ORCA_PROFILES_APPS_DIR` select the test folders; `orca profiles create --pin-root` also writes
  `OrcaAppProfilesRoot` into the profile's `Info.plist`.
- The apps ran with a test `HOME`. It holds one link, `Library/Keychains`, to the user's keychains.
- No GUI input was possible in the session (no clicks), so steps that need a click are not done.

**Bundle.** A profile bundle is 1.3 MB on disk with links. `codesign --verify` passes and
`codesign --verify --strict` fails ("invalid destination for symbolic link"), as expected.
`CodeResources` records each link as its target path. The helper copies keep their signatures.

| # | Answer | Evidence |
| --- | --- | --- |
| U1 | Yes, on macOS 27.2: the bundle with outside links launches. Work and Home ran as two foreground apps with their own bundle ids, Dock tiles and windows titled "Work" and "Home". Notifications and TCC: not measured (the notification permission request needs a closed onboarding, which needs a click). | `lsappinfo` |
| U2 | Yes. `open -a Work.app orca://skills/share/<id>` delivered `open-url` to Work, which does not claim `orca:`. Work moved to its Skills page. | window captures before and after |
| U3 | Not tested. | — |
| U4 | **No with a linked framework.** With `Electron Framework.framework` as a link, every child process (GPU, network service, renderer) stops at once with `EXC_BREAKPOINT` in `ElectronMain`, and the app exits with "GPU process isn't usable". **Yes with a cloned framework.** With an APFS clone of the framework (`cp -c`, about no extra disk) and no other change, the GPU, utility and renderer processes start and the window renders. `orca --profile work status` reaches Work. In Work's terminal, `ORCA_USER_DATA_PATH` is the profile folder, `orca` is `Work.app/Contents/Resources/bin/orca`, and `orca status` names Work's pid. The updater reports "updater-unavailable". Browser, computer use and the `orcad` template: not tested. | crash reports, process list, CLI output |
| U5 | Yes. The default app was replaced by `…profiles.2` (same Electron, same small executables, new `app.asar`). Work's cdhash, `codesign --verify` and `CodeResources` did not change. Work started on version `.2`, used its existing Keychain item and showed no prompt. TCC grant: not measured. | cdhash, `cmp`, Keychain item dates |
| U6 | The case with helpers of another identity than the ad-hoc browser process starts and connects (Electron 43.8.10). A Developer ID case is not tested. | process list |
| U7 | Notification helper: each profile's helper reads its own bundle's record (Work and Home: `not-determined`; the installed stable app: `denied`). The toggle check needs a click: not done. Keychain: a profile makes its own item `orca-<id> Safe Storage` with **no prompt**. After the profile's cdhash changed (it was signed again), the item asked for the **login keychain password** ("Work wants to use your confidential information stored in "orca-work Safe Storage" in your keychain", Always Allow, Deny, Allow), and the window stayed empty until an answer. A rebuild at an Electron upgrade changes the cdhash in the same way. | dialog capture |

**Changes from these results (in slice 1).**

- The thin bundle clones `Electron Framework.framework` with `cp -c` (option T with one clone). The
  other frameworks stay links. The clone changes only when Electron changes, so it is part of the
  `templateKey` rebuild (section 7) and U5 still holds.
- Terminal host H2 finds the default app through the real path of `Contents/Resources/app.asar`,
  because the framework is no longer a link. With the linked framework, H2 worked: the profile ran
  the default app's host copy under launchd from `<userData>/daemon-host/macos/`. With the cloned
  framework and the old lookup, terminals fell back to the in-process path. The new lookup and the
  survival of terminals over a profile restart are not tested in the app yet.

**Finding: a profile's serve service wrote the shared agent configs.** `orca serve service install`
loads the LaunchAgent at once, with `PATH` and `ORCA_USER_DATA_PATH` only. launchd gives the job the
login `HOME`. For about 2 s, before the test changed the unit, the profile's server ran with the real
home and installed the managed agent hooks there: `~/.claude/settings.json`, `~/.grok/hooks/orca-status.json`
and two files in `~/.orca/agent-hooks/`. Cause: the service did not carry the profile's environment,
and a profile app installed agent hooks into shared folders. Fix in slice 1:

- `orca serve service install` for a profile (its userData has the marker) writes `HOME`,
  `ORCA_HOME_DIR`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME` and `ORCA_PROFILES_ROOT` of the
  caller into the unit.
- A profile app, and every process that serves a profile's userData (also `orcad`), writes nothing
  to the shared agent folders until the isolation slice gives each profile its own folders. One
  check, `isAppProfileRuntime()`, stops: the managed hook install, refresh and removal; the Codex
  hook reconcile (`~/.codex/hooks.json`, the approvals in `config.toml` and the Codex script in
  `~/.orca/agent-hooks`), which runs at app start, in `orcad` and for each native terminal; the
  Claude agent view (`~/.claude/keybindings.json` and its markers); the OpenCode status plugin
  refresh; the Claude Code theme sync; and the uninstall of the shared hooks, plugins,
  `~/.orca/agent-hooks` and the `orca` command (the uninstall reports them as kept for the
  default app).
- A profile app writes its marker at start when it is missing, so `orcad` and the CLI find the
  profile.
- `orca profiles create` started from a profile's `orca` finds the default app through the
  profile's `app.asar` link, so it does not nest the bundle id. It writes `OrcaAppProfilesRoot`
  only with the hidden test flag `--pin-root`, never from an inherited `ORCA_PROFILES_ROOT`.
  An id has only `a-z`, `0-9` and `-`, so two names cannot share a bundle id. It writes the
  marker before the app is in place, and removes the app when registration fails.

- A profile app takes only its own folder. With `--user-data-dir`, the folder must carry the
  profile's marker; else the app stops. It writes its marker only into its own folder. `orca
  --profile <id> serve` and `orca open` start the target's own app: the profile's app, or the
  default app for `default`.

**Isolation (slice 2, in this PR).** Each profile has its own home folders under
`<userData>/orca-home`. The variables below are set in the process environment before any module
reads a path: by the main bundle's banner (Rolldown loads shared chunks before the entry's first
import, so an imported module is too late; `config/build-plugins/app-profile-homes-banner.ts`), by
the first module of the `orcad` bundle entry (esbuild keeps import order in one file), and by the
CLI's `--profile` selection. Terminals, serve, `orcad` and agent launches inherit them; a profile's
serve LaunchAgent carries them too. A profile sets all of them to its own folders, also when the
user set a value before the profile started. The default app removes only a profile's values: a
value under a profile's `orca-home` folder (its userData has the profile marker). It keeps every
other value. Path code is lazy: a static test fails on a helper call at module load.

Known limit: a shell startup file that exports one of these variables overrides the profile's
folder in that profile's terminals.

| Variable | Profile folder | Moves (each CLI's docs or source) |
| --- | --- | --- |
| `ORCA_HOME_DIR` | `orca-home` | `~/.orca`: credentials, API keys, cookies, hook scripts, host terminal policy, keybindings, theme sync, the hook install lock |
| `CLAUDE_CONFIG_DIR` | `orca-home/agents/claude` | Claude Code settings, hooks, sessions, plugins, `.claude.json`, `.credentials.json`, and its Keychain entry |
| `CODEX_HOME` | `agents/codex` | Codex `config.toml`, `auth.json`, history, logs |
| `GROK_HOME` | `agents/grok` | Grok Build config, auth, sessions, skills, plugins, logs |
| `COPILOT_HOME` | `agents/copilot` | Copilot CLI settings, auth, sessions, hooks |
| `HERMES_HOME` | `agents/hermes` | Hermes config and user data |
| `KIMI_CODE_HOME` | `agents/kimi-code` | Kimi Code config, sessions, logs, OAuth |
| `KIRO_HOME` | `agents/kiro` | Kiro agents, prompts, skills, settings, sessions |
| `OPENCLAW_STATE_DIR` | `agents/openclaw` | OpenClaw config, credentials, sessions, logs |
| `MIMOCODE_HOME` | `agents/mimocode` | MiMo Code config, data, state, cache |
| `GEMINI_CLI_HOME` | `agents/gemini` (Gemini makes `.gemini` in it) | Gemini CLI user config and storage |
| `QWEN_HOME` | `agents/qwen` | Qwen Code global config and runtime data |
| `QODER_CONFIG_DIR` | `agents/qoder` | Qoder CLI user config |
| `CODEBUDDY_CONFIG_DIR` | `agents/codebuddy` | CodeBuddy config, history, runtime data |
| `CLINE_DIR` | `agents/cline` | Cline CLI config, providers, sessions, logs |

Every Orca site that builds one of these folders goes through `app-profile-homes.ts`
(`orcaHomeDir()`, `defaultAgentHomeDir()`, `defaultClaudeJsonPath()`), and the Codex home path
(`getSystemCodexHomePath()`) follows `CODEX_HOME` from the profile. A static test fails when a raw
`homedir()` path, an `os.homedir()` path to `.claude.json` or a `$HOME/.<agent>` template for one
of these folders appears outside the helpers, unless the line reads the folder's variable first.
It also flags a home held in a name (`join(home, '.codex')`) and `app.getPath('home')`. Its
allow-list names each exception and its reason (WSL guest and other hosts' homes, Antigravity,
test harnesses, binary folders, `orcad`'s data folder, the frozen hook command forms). Skill
discovery, skill install roots (Gemini through `GEMINI_CLI_HOME`, CodeBuddy through
`CODEBUDDY_CONFIG_DIR`) and the workspace trust writers (Codex, Copilot, Qoder, Kimi, Qwen) take the
launch's variable, else the profile's folder.

The Keychain item is per profile: the profile start sets the name `orca-<id>` before ready, so
Electron uses "orca-<id> Safe Storage".

**Agents that stay on the real home.** These have no folder variable, or Orca rewrites the variable
per pane, or the folder moves only with XDG variables that would also move git and other tools:
Pi, OMP and Prime Agent (`PI_CODING_AGENT_DIR`, `PRIME_AGENT_CODING_AGENT_DIR`: Orca sets them per
pane), OpenCode (`OPENCODE_CONFIG_DIR` only adds a folder; config and data follow
`XDG_CONFIG_HOME` and `XDG_DATA_HOME`), Cursor (`CURSOR_CONFIG_DIR` moves only
`cli-config.json`), Antigravity, Devin, Factory, Rovo Dev, Amp, JCode, Zcode and DSH. For them, the
`isAppProfileRuntime()` checks stay the only guard: a profile installs, refreshes and removes no
hook, plugin or config of theirs.
The one exception is workspace trust: a profile that launches Cursor or Antigravity adds the
workspace to their trusted folders in the real home, as the default app does. The write adds a
trusted folder, and on worktree removal removes only the entries it added. That agent reads the
real home in a profile too.

**Safety model.** The per-profile folders are the first guard. The `isAppProfileRuntime()` checks
on each writer are the second one: a profile still installs no managed agent hooks. The hook
command forms keep `${HOME-}/.orca` (the Codex form is frozen bytes that Codex approves by hash),
so a later change that turns hooks on in a profile must first give the commands an
`ORCA_HOME_DIR` form.

Tests: the vitest real-home write guard also refuses writes to `~/.grok` and to the folders
that a profile's terminal exports, and it clears those variables before each test file.

**Other findings.**

- The floating workspace uses Electron's native home path; it is a working folder, not a config
  folder. Keybindings now follow `ORCA_HOME_DIR`.
- The profile apps show macOS "App Running in Background" notices for Work and Home (their terminal
  host jobs).
- The main window loads `app.asar` from the default app's real path.

**Not tested.** macOS 14, 15 and 26; notification entries, banners and clicks; the notification
toggle; TCC prompts and grants; U3; the serve service stop and restart by the app; the "Stop the
server and open" dialog; terminals over a profile restart; the browser, computer use and `orcad`.
