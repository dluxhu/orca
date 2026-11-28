#!/usr/bin/env bash
# Usage: NEW_APP=<new app> profile-e2e.sh dry|run
# End-to-end check of the profile refresh on an update: an older-style profile made by the
# installed release, then the new build in place of the default app.
#   dry   No GUI. The whole setup in a temp root: a profile "Loader Probe" made by the installed
#         release's CLI (RELEASE_APP, default /Applications/Orca @dLux.app), with a Finder custom
#         icon from set-icon, then NEW_APP (for a release: dist/mac-arm64/<app> of the release
#         worktree) in place of the default app. A pre-flight runs the profile app's own
#         executable as Node and prints every path it resolves. Then cleanup.
#   run   GUI, about 15 min, nobody at the keyboard. The same, then starts the profile app from
#         the new build: the refresh must run, the app must start again by itself (open -n), the
#         menu bar must say "Loader Probe". Screenshots (SHOTS, default ./profile-e2e-shots),
#         checks, quit, cleanup.
# Both modes put back what LaunchServices, launchd, the Keychain and the preferences got from
# the run, and print what changed in the real home folder (must be empty).
# No osascript of ours, no System Events, no accessibility API. (The product's set-icon uses
# AppKit through osascript -l JavaScript for the badge and the Finder icon; that is the path under
# test.)
set -euo pipefail

MODE=${1:-dry}
[[ $MODE == dry || $MODE == run ]] || { echo "usage: NEW_APP=<app> $0 dry|run" >&2; exit 64; }

HERE=$(cd "$(dirname "$0")" && pwd)
RELEASE_APP=${RELEASE_APP:-/Applications/Orca @dLux.app}
SHOTS=${SHOTS:-$PWD/profile-e2e-shots}
REAL_HOME=$HOME
UID_NUM=$(id -u)
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
PROFILE_NAME="Loader Probe"
PROFILE_ID=loader-probe
KEYCHAIN_ITEM="orca-$PROFILE_ID Safe Storage"

# ------------------------------------------------------------------------------------- dry / run
NEW_APP=${NEW_APP:?set NEW_APP to the new build}
HAVE_BUILD=0
[ -d "$NEW_APP" ] && HAVE_BUILD=1
[ $HAVE_BUILD -eq 1 ] || [ "$MODE" = dry ] || { echo "no app at NEW_APP=$NEW_APP" >&2; exit 1; }
[ -x "$RELEASE_APP/Contents/Resources/bin/orca" ] || { echo "no release app at $RELEASE_APP" >&2; exit 1; }
SRC_ID=$(plutil -extract CFBundleIdentifier raw "$RELEASE_APP/Contents/Info.plist")
PROFILE_BUNDLE_ID=$SRC_ID.profile.$PROFILE_ID
if lsappinfo list | grep -qE "bundleID=\"($SRC_ID|$SRC_ID.profile-manager|$PROFILE_BUNDLE_ID)\""; then
  echo "$SRC_ID, its Profile Manager or $PROFILE_BUNDLE_ID runs. Quit it first." >&2; exit 1
fi

ROOT=$(mktemp -d /tmp/orca-profile-e2e.XXXXXX)
ROOT=$(cd -P "$ROOT" && pwd)
trap 'rm -rf "$ROOT"' EXIT
T_HOME=$ROOT/home
PROFILES_ROOT="$T_HOME/Library/Application Support/Orca Profiles"
APPS_DIR="$T_HOME/Applications/Orca Profiles"
DEFAULT_APP="$ROOT/apps/Orca @dLux.app"
OLD_PARKED="$ROOT/old/Orca @dLux.app"
PROFILE_APP="$APPS_DIR/$PROFILE_NAME.app"
mkdir -p "$T_HOME" "$ROOT/tmp" "$ROOT/apps" "$ROOT/old" "$ROOT/prefs"
MARKER=$ROOT/start-marker
touch "$MARKER"
sleep 1
swiftc -O -o "$ROOT/url-handler" "$HERE/url-handler.swift" 2>/dev/null
ORCA_HANDLER_BEFORE=$("$ROOT/url-handler" get orca)

PREF_IDS=("$SRC_ID" "$SRC_ID.profile-manager" "$PROFILE_BUNDLE_ID")
REAL_PATHS=(
  "$RELEASE_APP" "$RELEASE_APP/Contents/Info.plist"
  "$REAL_HOME/Library/Application Support/orca"
  "$REAL_HOME/Library/Application Support/Orca @dLux"
  "$REAL_HOME/Library/Application Support/Orca Profiles"
  "$REAL_HOME/Library/Application Support/Orca Profiles/profiles.json"
  "$REAL_HOME/Applications/Orca Profiles"
  "$REAL_HOME/Library/LaunchAgents"
  "$REAL_HOME/Library/Logs/orca-$PROFILE_ID"
  "$REAL_HOME/Library/Caches/$PROFILE_BUNDLE_ID"
  "$REAL_HOME/Library/HTTPStorages/$PROFILE_BUNDLE_ID"
  "$REAL_HOME/Library/WebKit/$PROFILE_BUNDLE_ID"
  "$REAL_HOME/Library/Saved Application State/$PROFILE_BUNDLE_ID.savedState"
  "$REAL_HOME/.orca" "$REAL_HOME/.claude" "$REAL_HOME/.claude.json" "$REAL_HOME/.codex"
)
for id in "${PREF_IDS[@]}"; do REAL_PATHS+=("$REAL_HOME/Library/Preferences/$id.plist"); done
snapshot() {
  local path
  for path in "${REAL_PATHS[@]}"; do
    if [ -e "$path" ]; then
      echo "$(stat -f '%m' "$path") $(ls -A "$path" 2>/dev/null | shasum | cut -c1-12) $path"
    else
      echo "missing - $path"
    fi
  done
  security find-generic-password -s "$KEYCHAIN_ITEM" >/dev/null 2>&1 && echo "keychain: $KEYCHAIN_ITEM" || echo "keychain: none"
  echo "orca: handler $("$ROOT/url-handler" get orca)"
}
snapshot > "$ROOT/real-before.txt"
for id in "${PREF_IDS[@]}"; do
  [ -f "$REAL_HOME/Library/Preferences/$id.plist" ] && defaults export "$id" "$ROOT/prefs/$id.plist"
done

CLEAN_ENV=(env -i "HOME=$T_HOME" "USER=$USER" "LOGNAME=$USER" "SHELL=/bin/zsh"
  "PATH=/usr/bin:/bin:/usr/sbin:/sbin" "TMPDIR=$ROOT/tmp/" "LANG=en_US.UTF-8"
  "ORCA_PROFILES_ROOT=$PROFILES_ROOT" "ORCA_PROFILES_APPS_DIR=$APPS_DIR"
  "ORCA_STARTUP_DIAGNOSTICS=1")

cleanup() {
  set +e
  pkill -TERM -f "$ROOT" 2>/dev/null; sleep 5; pkill -KILL -f "$ROOT" 2>/dev/null
  launchctl print "gui/$UID_NUM" 2>/dev/null | grep -oE 'com\.stablyai\.orca[A-Za-z0-9._-]*' | sort -u |
    while read -r label; do
      launchctl print "gui/$UID_NUM/$label" 2>/dev/null | grep -qF "$ROOT" &&
        { echo "launchd: bootout $label"; launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null; }
    done
  # LaunchServices: every temp bundle out; the installed apps in again.
  find "$ROOT" -maxdepth 5 -name '*.app' -prune -print 2>/dev/null | while read -r app; do
    "$LSREGISTER" -u "$app" 2>/dev/null
    [ -d "$app/Contents/Applications/Orca Profile Manager.app" ] &&
      "$LSREGISTER" -u "$app/Contents/Applications/Orca Profile Manager.app" 2>/dev/null
  done
  "$LSREGISTER" -f "$RELEASE_APP"
  [ -d "$RELEASE_APP/Contents/Applications/Orca Profile Manager.app" ] &&
    "$LSREGISTER" -f "$RELEASE_APP/Contents/Applications/Orca Profile Manager.app"
  local after
  after=$("$ROOT/url-handler" get orca)
  if [ "$after" != "$ORCA_HANDLER_BEFORE" ] && [ "$ORCA_HANDLER_BEFORE" != "(none)" ]; then
    "$ROOT/url-handler" set orca "$ORCA_HANDLER_BEFORE" && echo "orca: handler set back to $ORCA_HANDLER_BEFORE"
  fi
  # The relaunch through LaunchServices runs with the login environment: the real Keychain and
  # the real Library folders of the profile's bundle id. All of them go.
  while security delete-generic-password -s "$KEYCHAIN_ITEM" >/dev/null 2>&1; do echo "keychain: removed $KEYCHAIN_ITEM"; done
  for id in "${PREF_IDS[@]}"; do
    if [ -f "$ROOT/prefs/$id.plist" ]; then
      defaults export "$id" "$ROOT/prefs/$id.after.plist" 2>/dev/null
      cmp -s "$ROOT/prefs/$id.plist" "$ROOT/prefs/$id.after.plist" ||
        { defaults import "$id" "$ROOT/prefs/$id.plist" && echo "prefs: put back $id"; }
    elif [ -f "$REAL_HOME/Library/Preferences/$id.plist" ]; then
      defaults delete "$id" >/dev/null 2>&1; rm -f "$REAL_HOME/Library/Preferences/$id.plist"; echo "prefs: removed new $id"
    fi
  done
  for path in "$REAL_HOME/Library/Logs/orca-$PROFILE_ID" "$REAL_HOME/Library/Caches/$PROFILE_BUNDLE_ID" \
    "$REAL_HOME/Library/HTTPStorages/$PROFILE_BUNDLE_ID" "$REAL_HOME/Library/WebKit/$PROFILE_BUNDLE_ID" \
    "$REAL_HOME/Library/Saved Application State/$PROFILE_BUNDLE_ID.savedState"; do
    # Only what the run made: a path that existed before stays.
    if [ -e "$path" ] && grep -qxF "missing - $path" "$ROOT/real-before.txt"; then
      rm -rf "$path"; echo "removed new $path"
    fi
  done
  snapshot > "$ROOT/real-after.txt"
  echo "== Real paths, Keychain item and orca: handler changed (must be empty):"
  diff "$ROOT/real-before.txt" "$ROOT/real-after.txt" | grep '^[<>]' || echo "(none)"
  echo "== Real files newer than the start with stablyai, orca-$PROFILE_ID or probe in the name:"
  find "$REAL_HOME/Library/Preferences" "$REAL_HOME/Library/Saved Application State" "$REAL_HOME/Library/Caches" \
    "$REAL_HOME/Library/Logs" "$REAL_HOME/Library/LaunchAgents" "$REAL_HOME/Applications" -maxdepth 2 -newer "$MARKER" \
    \( -iname '*probe*' -o -iname "*$PROFILE_ID*" -o -iname '*stablyai*' \) 2>/dev/null || true
  rm -rf "$ROOT"
  echo "== Removed $ROOT"
}
trap cleanup EXIT

plist() { plutil -extract "$2" raw "$1/Contents/Info.plist" 2>/dev/null || echo "(none)"; }
state() { # bundle -> one line per fact the check reads
  echo "   CFBundleName        $(plist "$1" CFBundleName)"
  echo "   CFBundleVersion     $(plist "$1" CFBundleVersion)"
  echo "   template key        $(plist "$1" OrcaProfileTemplateKey)"
  echo "   helpers             $(ls "$1/Contents/Frameworks" | grep -E 'Helper' | tr '\n' ';')"
  echo "   Finder information  $(xattr -px com.apple.FinderInfo "$1" 2>/dev/null | tr -d ' \n' | cut -c1-24)"
  echo "   Icon file           $([ -e "$1/Icon"$'\r' ] && echo yes || echo no)"
  echo "   app.asar            $(readlink "$1/Contents/Resources/app.asar" 2>/dev/null || { [ -e "$1/Contents/Resources/app.asar" ] && echo file || echo none; })"
  echo "   loader              $([ -f "$1/Contents/Resources/app/boot.js" ] && echo yes || echo no)"
  if codesign --verify "$1" 2>/dev/null; then echo "   codesign --verify   ok"; else echo "   codesign --verify   FAILED"; fi
}

echo "== 1. The old default app: a clone of the release (APFS clone, no disk use)"
cp -Rc "$RELEASE_APP" "$DEFAULT_APP"
echo "   $(plist "$DEFAULT_APP" CFBundleShortVersionString)"

echo "== 2. An older-style profile, made by the release CLI (temp HOME $T_HOME)"
"${CLEAN_ENV[@]}" "$DEFAULT_APP/Contents/Resources/bin/orca" profiles create "$PROFILE_NAME" --id "$PROFILE_ID" --pin-root --json >/dev/null
case "$(cd -P "$PROFILE_APP" && pwd)" in "$ROOT"/*) ;; *) echo "profile app outside the temp root" >&2; exit 1 ;; esac
[ "$(plist "$PROFILE_APP" CFBundleIdentifier)" = "$PROFILE_BUNDLE_ID" ] || { echo "unexpected bundle id" >&2; exit 1; }
echo "== 3. A Finder custom icon through the real set-icon path"
"${CLEAN_ENV[@]}" "$DEFAULT_APP/Contents/Resources/bin/orca" profiles set-icon "$PROFILE_ID" --icon-badge R --json >/dev/null
echo "-- before the refresh:"
state "$PROFILE_APP" | tee "$ROOT/before.txt"
grep -q "template key        (none)" "$ROOT/before.txt" || echo "   NOTE: the release already records a template key"
grep -q "Finder information  0" "$ROOT/before.txt" || { echo "no Finder information after set-icon" >&2; exit 1; }

if [ $HAVE_BUILD -eq 1 ]; then
  echo "== 4. The update: the new build takes the default app's place"
  mv "$DEFAULT_APP" "$OLD_PARKED"
  cp -Rc "$NEW_APP" "$DEFAULT_APP"
  echo "   new default app $(plist "$DEFAULT_APP" CFBundleShortVersionString)"
else
  echo "== 4. SKIPPED (dry): no app at NEW_APP=$NEW_APP"
fi

echo "== 5. Pre-flight (no GUI): the profile app's own executable as Node, with the start environment"
EXE="$PROFILE_APP/Contents/MacOS/$(plist "$PROFILE_APP" CFBundleExecutable)"
"${CLEAN_ENV[@]}" ELECTRON_RUN_AS_NODE=1 "$EXE" -e '
  const os = require("os"); const fs = require("fs"); const path = require("path")
  console.log("   HOME            " + os.homedir())
  console.log("   TMPDIR          " + os.tmpdir())
  console.log("   execPath        " + process.execPath)
  const res = path.join(path.dirname(process.execPath), "..", "Resources")
  console.log("   unpacked ->     " + fs.realpathSync(path.join(res, "app.asar.unpacked")))
' | tee "$ROOT/preflight.txt"
echo "   profiles root   $(plist "$PROFILE_APP" OrcaAppProfilesRoot)"
echo "   userData        $PROFILES_ROOT/$PROFILE_ID (pinned by OrcaAppProfilesRoot)"
"${CLEAN_ENV[@]}" "$DEFAULT_APP/Contents/Resources/bin/orca" profiles list --json 2>/dev/null |
  grep -E '"(appPath|userDataPath)"' | sed 's/^ */   list: /' | tee -a "$ROOT/preflight.txt"
bad=0
while read -r line; do
  case "$line" in *"$ROOT"*) ;; *) echo "   OUTSIDE THE TEMP ROOT: $line"; bad=1 ;; esac
done < <(grep -E '/' "$ROOT/preflight.txt")
[ "$(plist "$PROFILE_APP" OrcaAppProfilesRoot)" = "$PROFILES_ROOT" ] || { echo "   the pinned root is not the temp root"; bad=1; }
find "$PROFILE_APP/Contents/Resources" "$PROFILE_APP/Contents/Frameworks" -maxdepth 1 -type l | while read -r link; do
  case "$(readlink "$link")" in "$ROOT"/*) ;; *) echo "   LINK OUT OF THE TEMP ROOT: $link"; exit 1 ;; esac
done || bad=1
[ $bad -eq 0 ] && echo "   pre-flight: every path is inside $ROOT"
[ $bad -eq 0 ] || { echo "pre-flight failed" >&2; exit 1; }

if [ "$MODE" = dry ]; then
  echo "== dry: no app started. Cleanup."
  exit 0
fi

# ------------------------------------------------------------------------------------------ run
mkdir -p "$SHOTS"; rm -f "$SHOTS"/*
swiftc -O -o "$ROOT/window-ids" "$HERE/window-ids.swift"
read -r SCREEN_W _ <<<"$("$ROOT/window-ids" --screen)"
pids_of() { pgrep -f "$PROFILE_APP/Contents/MacOS/" || true; }

echo "== 6. Start the profile app from the new build (temp HOME, mock keychain)"
"${CLEAN_ENV[@]}" "$EXE" --use-mock-keychain >"$ROOT/first.log" 2>&1 &
FIRST=$!
for i in $(seq 1 120); do kill -0 "$FIRST" 2>/dev/null || break; sleep 1; done
kill -0 "$FIRST" 2>/dev/null && echo "   FAIL: the first start did not exit (no refresh?)" || echo "   first start exited after ~${i} s"
echo "== 7. Wait for the start again (open -n, LaunchServices environment)"
NEXT=""
for i in $(seq 1 60); do NEXT=$(pids_of | grep -vx "$FIRST" | head -1); [ -n "$NEXT" ] && break; sleep 1; done
[ -n "$NEXT" ] && echo "   started again: pid $NEXT after ~${i} s" || echo "   FAIL: no new process of the profile app"
for i in $(seq 1 90); do [ -n "$NEXT" ] && [ -n "$("$ROOT/window-ids" "$NEXT" | head -1)" ] && break; sleep 1; done
sleep 8
open -a "$PROFILE_APP"; sleep 3
front=$(lsappinfo info -only name -only bundleID -only bundlepath "$(lsappinfo front)" | tr -s ' \n' ' ')
echo "   front app: $front" | tee "$SHOTS/front.txt"
screencapture -x -R "0,0,$((SCREEN_W / 2)),40" "$SHOTS/menu-bar.png" && echo "   shot: $SHOTS/menu-bar.png"
echo "-- after the refresh:"
state "$PROFILE_APP" | tee "$ROOT/after.txt"
fail=0
ok() { local name=$1; shift; if "$@" >/dev/null 2>&1; then echo "PASS $name"; else echo "FAIL $name"; fail=1; fi; }
ok "refresh ran (template key recorded)" bash -c '! grep -q "template key        (none)" "$1"' _ "$ROOT/after.txt"
ok "CFBundleName is the profile name" test "$(plist "$PROFILE_APP" CFBundleName)" = "$PROFILE_NAME"
ok "helpers renamed" test -d "$PROFILE_APP/Contents/Frameworks/$PROFILE_NAME Helper (Renderer).app"
ok "no helper with the default name" bash -c '! ls "$1" | grep -q "^Orca @dLux Helper"' _ "$PROFILE_APP/Contents/Frameworks"
ok "Finder custom icon kept" grep -q 'Finder information  0' "$ROOT/after.txt"
ok "Icon file kept" test -e "$PROFILE_APP/Icon"$'\r'
ok "codesign --verify" codesign --verify "$PROFILE_APP"
ok "came back by itself" test -n "$NEXT"
ok "front app is the profile app" grep -q "$PROFILE_BUNDLE_ID" "$SHOTS/front.txt"
ok "previous bundle removed after the new start" test ! -e "$PROFILE_APP.pre-refresh"
ok "loader in place" test -f "$PROFILE_APP/Contents/Resources/app/boot.js"
ok "no app.asar link left" test ! -e "$PROFILE_APP/Contents/Resources/app.asar"
ok "the new start runs the new version" bash -c 'ps -o command= -p "$1" | grep -q .' _ "$NEXT"
echo "   look at $SHOTS/menu-bar.png: the bold name must be \"$PROFILE_NAME\""
grep -E '\[startup\]|refresh|Error' "$ROOT/first.log" | tail -8 | sed 's/^/   first.log: /' || true
echo "== 8. Quit and clean up"
[ $fail -eq 0 ] && echo "profile-e2e: all checks passed" || echo "profile-e2e: FAILED checks above"
