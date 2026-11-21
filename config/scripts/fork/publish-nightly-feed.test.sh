#!/usr/bin/env bash
# Self-test for publish-nightly-feed.sh, with a stub `gh`. It sends nothing to GitHub.
# Run: config/scripts/fork/publish-nightly-feed.test.sh
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/publish-nightly-feed.sh
root=$(mktemp -d "${TMPDIR:-/tmp}/nightly-feed-test.XXXXXX")
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin"
# The stub logs each call. `release download` writes a small zip. `release view nightly`
# fails until `release create` makes the feed. `release upload` keeps the file.
cat >"$root/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$STUB/calls"
case "$1 $2" in
  'release download') dir=${@: -1}; printf 'zip bytes' >"$dir/$(echo "$*" | sed -E 's/.* -p ([^ ]+) .*/\1/')" ;;
  'release view') if [ "$3" = nightly ]; then [ -f "$STUB/created" ]; else echo 2026-11-21T12:53:41Z; fi ;;
  'release create') touch "$STUB/created" ;;
  'release upload') cp "$4" "$STUB/uploaded.yml" ;;
esac
EOF
chmod +x "$root/bin/gh"
export PATH="$root/bin:$PATH" STUB="$root"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

tag=v1.4.268-daily.202611201835-dlux.3
sha=$(printf 'zip bytes' | openssl dgst -sha512 -binary | openssl base64 -A)
url="https://github.com/dluxhu/orca/releases/download/$tag/orca-nightly-1.4.268-daily.202611201835-dlux.3-arm64-mac.zip"
expected="version: 1.4.268-daily.202611201835-dlux.3
files:
  - url: $url
    sha512: $sha
    size: 9
path: $url
sha512: $sha
releaseDate: '2026-11-21T12:53:41Z'"

# A dry run prints the manifest and changes no release.
out=$("$script" "$tag" --dry-run)
[ "$out" = "$expected" ] || fail "dry run manifest: $out"
grep -qE 'release (create|upload)' "$root/calls" && fail 'dry run changed a release'

# The first run makes the feed release and uploads the manifest.
"$script" "$tag" >/dev/null
[ "$(cat "$root/uploaded.yml")" = "$expected" ] || fail 'uploaded manifest'
grep -q 'release create nightly -R dluxhu/orca --prerelease --latest=false' "$root/calls" ||
  fail 'feed release is not a prerelease'

# A later run replaces the manifest and does not make the release again.
: >"$root/calls"
"$script" "$tag" >/dev/null
grep -q 'release create' "$root/calls" && fail 'second run made the release again'
grep -q 'release upload nightly .* --clobber' "$root/calls" || fail 'second run did not replace the manifest'

# A stable tag and the feed tag are not nightly builds.
for bad in v1.4.268-dlux.1 nightly; do
  if "$script" "$bad" 2>/dev/null; then fail "accepted $bad"; fi
done

[ "$failures" = 0 ] && echo 'publish-nightly-feed: all tests pass'
exit "$failures"
