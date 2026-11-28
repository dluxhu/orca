#!/usr/bin/env bash
# Usage: build-app.sh <release worktree> <version> <upstream zip>
# PATCHES.md "Release steps" 4: builds the release app in the worktree that build-release.sh
# made, then checks it and smoke-tests it. Signed with the Developer ID of the login keychain,
# not notarized. Starts no visible window. Heavy: run it as one job. Prints "result: PASS|FAIL".
#   <upstream zip>  upstream's Orca-<base>-arm64-mac.zip of the same version (the orcad template
#                   targets come from it):
#                   gh release download v<base> -R stablyai/orca -p 'Orca-<base>-arm64-mac.zip'
# LAST_RELEASE_ZIP=<zip> LAST_RELEASE_COMMIT=<commit>: the last fork release's app zip and commit.
#   A Swift helper whose sources are the same as at that commit is taken from that app (its
#   helpers carry the fork identity; upstream's do not). Without them every helper is built.
# SKIP_PM_SMOKE=1 skips the Profile Manager smoke (it opens a hidden Electron window).
# NODE_BIN_DIR=<Node 24 bin folder> is put first in PATH.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
[ $# -eq 3 ] || { sed -n '2p' "$0" >&2; exit 64; }
W=$1 VERSION=$2 UPZIP=$3
REL=${LAST_RELEASE_ZIP:-} REL_COMMIT=${LAST_RELEASE_COMMIT:-}
[ -f "$UPZIP" ] || { echo "no upstream zip $UPZIP" >&2; exit 1; }
[ -z "$REL" ] || [ -f "$REL" ] || { echo "no last release zip $REL" >&2; exit 1; }
BUILD=$(mktemp -d "${TMPDIR:-/tmp}/fork-build.XXXXXX")
trap 'rm -rf "$BUILD"; echo "removed $BUILD, free $(df -h / | awk '"'"'NR==2{print $4}'"'"')"' EXIT
use_node || exit 1
export HUSKY=0
unset ORCA_CLI_COMMAND ORCA_CLI_HANDOFF
cd "$W" || exit 1
echo "=== $W head $(git rev-parse --short=11 HEAD) free $(df -h / | awk 'NR==2{print $4}')"
step() {
  # Stop before a step when the disk is under 10 GiB free.
  local free_k
  free_k=$(df -k / | awk 'NR==2{print $4}')
  [ "$free_k" -ge 10485760 ] || { echo "FAILED: disk under 10 GiB before: $*"; echo "result: FAIL"; exit 1; }
  echo "=== $(date +%H:%M:%S) $*"
  "$@" 2>&1 | LC_ALL=C sed -l -E '/Signing with identity|Developer ID Application:|Authority=/d' | tail -25
  local rc=${PIPESTATUS[0]}
  [ "$rc" -eq 0 ] || { echo "FAILED rc=$rc: $*"; echo "result: FAIL"; exit "$rc"; }
}
# The identity hash only; it is never printed.
CSC_NAME=$(security find-identity -v -p codesigning | awk '/Developer ID Application/{print $2; exit}')
[ -n "$CSC_NAME" ] || { echo "FAILED: no Developer ID identity"; echo "result: FAIL"; exit 1; }
export CSC_NAME
same() { [ -n "$REL" ] && git diff --quiet "$REL_COMMIT" HEAD -- "native/$1" config/scripts/native-build/macos; }
R=
if [ -n "$REL" ]; then
  step ditto -x -k "$REL" "$BUILD/rel"
  R=$(ls -d "$BUILD"/rel/*.app | head -1)/Contents
fi
# The Computer Use helper is always built from source.
# Release signing: Developer ID, hardened runtime, the helper's entitlements.
step env ORCA_MAC_RELEASE=1 pnpm run build:computer-macos
if same notification-status-macos; then
  step ditto "$R/MacOS/orca-notification-status" native/notification-status-macos/.build/release/orca-notification-status
  step ditto "$R/Resources/profile-template/orca-notification-status" native/notification-status-macos/.build/release/profile-template/orca-notification-status
else
  step pnpm run build:notification-status-macos --single-arch
fi
if same keyboard-layout-macos; then
  step ditto "$R/MacOS/orca-keyboard-layout" native/keyboard-layout-macos/.build/release/orca-keyboard-layout
else
  step pnpm run build:keyboard-layout-macos --single-arch
fi
if same process-footprint-macos; then
  step ditto "$R/MacOS/orca-process-footprint" native/process-footprint-macos/.build/release/orca-process-footprint
else
  step pnpm run build:process-footprint-macos --single-arch
fi
# electron-builder copies it into Contents/MacOS.
step pnpm run build:socket-owner-macos --single-arch
rm -rf "$BUILD/rel"
step pnpm install --frozen-lockfile
step pnpm -C mobile install --frozen-lockfile
step pnpm run build:desktop
step pnpm run ensure:electron-runtime
step pnpm run build:orcad-prebuilds
step node config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets darwin-arm64
step ditto -x -k "$UPZIP" "$BUILD/up"
step node config/scripts/fork/graft-orcad-template-targets.mjs "$BUILD/up/Orca.app/Contents/Resources"
rm -rf "$BUILD/up"
step env ORCA_REQUIRE_ORCAD_TEMPLATE=1 ORCA_LOCAL_BUILD_VERSION="$VERSION" \
  pnpm exec electron-builder --config config/electron-builder.config.cjs --mac zip dmg --arm64 --publish never
echo "=== $(date +%H:%M:%S) BUILD OK"

A=$(ls -d "$W"/dist/mac-arm64/*.app | head -1)
N="$A/Contents/Applications/Orca Profile Manager.app"
fail=0
check() { if "$@" >/dev/null 2>&1; then echo "PASS $CHECK"; else echo "FAIL $CHECK"; fail=1; fi; }
echo "=== checks on $A"
CHECK="version $VERSION" check test "$(plutil -extract CFBundleShortVersionString raw "$A/Contents/Info.plist")" = "$VERSION"
CHECK="orcad template" check test -d "$A/Contents/Resources/orcad-template"
CHECK="nested app exists" check test -d "$N"
CHECK="bundle id" check test "$(plutil -extract CFBundleIdentifier raw "$N/Contents/Info.plist")" = "$(plutil -extract CFBundleIdentifier raw "$A/Contents/Info.plist").profile-manager"
CHECK="socket-owner helper" check test -x "$A/Contents/MacOS/orca-socket-owner"
CHECK="nested menu-bar name" check test "$(plutil -extract CFBundleName raw "$N/Contents/Info.plist")" = "$(plutil -extract CFBundleName raw "$A/Contents/Info.plist") Profile Manager"
plutil -extract CFBundleName raw "$N/Contents/Info.plist"
CHECK="OrcaAppRole" check test "$(plutil -extract OrcaAppRole raw "$N/Contents/Info.plist")" = profile-manager
CHECK="no orca: claim" check bash -c "! plutil -extract CFBundleURLTypes raw '$N/Contents/Info.plist'"
CHECK="framework is a real folder" check bash -c "test -d '$N/Contents/Frameworks/Electron Framework.framework' && ! test -L '$N/Contents/Frameworks/Electron Framework.framework'"
CHECK="every link resolves inside the outer app" check python3 -I -c '
import os, sys
nested, outer = sys.argv[1], os.path.realpath(sys.argv[2])
links = [os.path.join(d, e) for d in ("Contents/Resources", "Contents/Frameworks")
         for e in os.listdir(os.path.join(nested, d)) if os.path.islink(os.path.join(nested, d, e))]
assert links
for link in links:
    target = os.path.realpath(os.path.join(nested, link))
    assert os.path.exists(target) and target.startswith(outer + "/"), link
' "$N" "$A"
echo "=== codesign --verify --deep --strict (outer)"
codesign --verify --deep --strict --verbose=2 "$A" 2>&1 | tail -4
CHECK="outer --deep --strict" check codesign --verify --deep --strict "$A"
CU="$A/Contents/Resources/Orca Computer Use.app"
# electron-builder re-signs the helper without the hardened runtime; only notarization needs it.
codesign -dv "$CU" 2>&1 | grep -q 'flags=.*runtime' && echo "PASS Computer Use helper has the hardened runtime" ||
  echo "WARN Computer Use helper has no hardened runtime (needed only for notarization)"
echo "=== codesign --verify (nested, not strict: its links leave the nested bundle)"
codesign --verify --verbose=2 "$N" 2>&1 | tail -3
CHECK="nested --verify" check codesign --verify "$N"
codesign -dv "$A" 2>&1 | grep -E '^(Identifier|TeamIdentifier)='
codesign -dv "$N" 2>&1 | grep -E '^(Identifier|TeamIdentifier)='
echo "=== sizes"; du -sh "$A" "$N"; ls -la "$W"/dist | grep -E '\.(zip|dmg|blockmap|yml)$'
cat "$W"/dist/latest-mac.yml

echo "=== smoke"
probe=$(mktemp -d "${TMPDIR:-/tmp}/fork-probe.XXXXXX"); mkdir -p "$probe/home"
CLI="$A/Contents/Resources/bin/orca"
CHECK="orca --help" check env -i PATH=/usr/bin:/bin HOME="$probe/home" "$CLI" --help
env -i PATH=/usr/bin:/bin HOME="$probe/home" "$CLI" --help 2>&1 | head -5
EXE="$N/Contents/MacOS/$(plutil -extract CFBundleExecutable raw "$N/Contents/Info.plist")"
LIST=$(env -i PATH=/usr/bin:/bin HOME="$probe/home" ORCA_PROFILES_ROOT="$probe/profiles" ELECTRON_RUN_AS_NODE=1 \
  "$EXE" "$N/Contents/Resources/app.asar.unpacked/out/cli/index.js" profiles list --json 2>&1)
echo "$LIST" | head -12
CHECK="CLI in the Manager app finds the outer app" check bash -c 'echo "$1" | grep -F "\"appPath\": \"$2\""' _ "$LIST" "$(cd -P "$A" && pwd)"
freeport() { python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
PORT=$(freeport)
serve_up() { # <log>: starts serve in the probe profile, sets SP and ready
  # Clean env, temp HOME, separate profile; the ORCA_E2E_* variables give a mock Keychain.
  env -i PATH=/usr/bin:/bin HOME="$probe/home" ORCA_E2E_HOME_DIR="$probe/home" ORCA_E2E_USER_DATA_DIR="$probe" \
    ORCA_USER_DATA_PATH="$probe" ORCA_CLI_INSTALL_PATH="$probe/bin/orca" \
    "$CLI" serve --port "$PORT" --bind 127.0.0.1 --no-pairing >"$1" 2>&1 &
  SP=$!
  t0=$(date +%s); ready=no
  while [ $(( $(date +%s) - t0 )) -lt 60 ]; do
    grep -q 'Orca server ready' "$1" && { ready=yes; break; }
    kill -0 $SP 2>/dev/null || break
    sleep 1
  done
  echo "serve on $PORT: ready=$ready after $(( $(date +%s) - t0 )) s"
}
serve_down() { kill -INT $SP 2>/dev/null; sleep 5; kill -0 $SP 2>/dev/null && kill -TERM $SP; sleep 2; pkill -f "$probe" 2>/dev/null; }
serve_up "$probe/serve.log"; serve_down
[ "$ready" = yes ] || { echo "FAIL serve ready"; tail -20 "$probe/serve.log"; fail=1; }
echo "=== local webhooks smoke: settings.update on the running serve, then POST"
WPORT=$(freeport)
serve_up "$probe/serve2.log"
if [ "$ready" = yes ]; then
  # The CLI's own call over the runtime socket: one JSON line with the metadata's auth token.
  upd=$(python3 -I - "$probe/orca-runtime.json" "$WPORT" <<'PY'
import json, socket, sys
meta = json.load(open(sys.argv[1]))
unix = next(t['endpoint'] for t in meta['transports'] if t['kind'] == 'unix')
s = socket.socket(socket.AF_UNIX); s.settimeout(20); s.connect(unix)
params = {'localWebhooksEnabled': True, 'localWebhooksBindAddress': '127.0.0.1', 'localWebhooksPort': int(sys.argv[2])}
s.sendall((json.dumps({'id': 'smoke-1', 'authToken': meta['authToken'], 'method': 'settings.update', 'params': params}) + '\n').encode())
buf = b''
while not buf.endswith(b'\n'):
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
print('ok' if json.loads(buf.decode().splitlines()[0]).get('ok') else 'refused: ' + buf.decode()[:300])
PY
  )
  echo "settings.update: $upd"
  CHECK="local webhooks: settings.update" check test "$upd" = ok
  url="http://127.0.0.1:$WPORT/hooks"
  t0=$(date +%s)
  until curl -s -o /dev/null "$url" || [ $(( $(date +%s) - t0 )) -ge 15 ]; do sleep 1; done
  nokey=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url/wh_smoke0000000000000000")
  unknown=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
    -d '{"smoke":true}' "$url/wh_smoke0000000000000000/k_smoke")
  echo "listener on $WPORT: POST without key -> $nokey, POST with a key to an unknown hook -> $unknown"
  CHECK="local webhooks: no key 401" check test "$nokey" = 401
  CHECK="local webhooks: unknown hook 404" check test "$unknown" = 404
else
  echo "FAIL serve ready (second start)"; tail -20 "$probe/serve2.log"; fail=1
fi
serve_down
rm -rf "$probe"
if [ "${SKIP_PM_SMOKE:-}" = 1 ]; then
  echo "=== Profile Manager smoke: SKIPPED (SKIP_PM_SMOKE=1)"
else
  echo "=== Profile Manager smoke: a hidden window must render the page"
  # env -i and an empty profiles root. Do not start it through perl alarm and exec: then the Manager exits with no output.
  sm=$(mktemp -d "${TMPDIR:-/tmp}/fork-smoke.XXXXXX"); mkdir -p "$sm/root" "$sm/apps"
  SMOKE=$(env -i PATH=/usr/bin:/bin HOME="$HOME" ORCA_PROFILES_ROOT="$sm/root" ORCA_PROFILES_APPS_DIR="$sm/apps" \
    ORCA_PROFILE_MANAGER_SMOKE=1 /usr/bin/timeout 60 "$EXE" 2>&1 | grep -E '^profile-manager-smoke: ')
  echo "${SMOKE:-profile-manager-smoke: fail no result line (timeout or crash)}"
  CHECK="Profile Manager page renders (smoke)" check bash -c 'echo "$1" | grep -q "^profile-manager-smoke: ok .*/out/renderer/profile-manager.html"' _ "$SMOKE"
  pkill -f "$sm" 2>/dev/null; rm -rf "$sm"
fi
echo "free $(df -h / | awk 'NR==2{print $4}')"
if [ "$fail" -eq 0 ]; then echo "result: PASS"; else echo "result: FAIL"; exit 1; fi
