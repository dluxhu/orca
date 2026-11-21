#!/usr/bin/env bash
# Points the Nightly update feed at a published nightly release.
# The feed is the fixed prerelease `nightly` of the fork. The Nightly app reads its
# latest-mac.yml. The file names the zip of the nightly release by its full URL, so the
# zip stays in its own release.
# Usage: config/scripts/fork/publish-nightly-feed.sh <nightly tag> [--repo <owner/name>] [--dry-run]
#   --dry-run  Print latest-mac.yml. Do not change a release.
set -euo pipefail

repo=dluxhu/orca
dry_run=0
tag=
while [ $# -gt 0 ]; do
  case $1 in
    --repo) repo=$2; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) tag=$1; shift ;;
  esac
done
if ! [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+-daily\.[0-9]{12}-dlux\.[0-9]+$ ]]; then
  echo "not a nightly tag: '$tag' (example: v1.4.268-daily.202611201835-dlux.3)" >&2
  exit 2
fi
version=${tag#v}
zip="orca-nightly-$version-arm64-mac.zip"
url="https://github.com/$repo/releases/download/$tag/$zip"
work=$(mktemp -d "${TMPDIR:-/tmp}/nightly-feed.XXXXXX")
trap 'rm -rf "$work"' EXIT

# The hash and size come from the published zip, the file that the app downloads.
gh release download "$tag" -R "$repo" -p "$zip" -D "$work"
sha512=$(openssl dgst -sha512 -binary "$work/$zip" | openssl base64 -A)
size=$(wc -c <"$work/$zip" | tr -d ' ')
released=$(gh release view "$tag" -R "$repo" --json publishedAt -q .publishedAt)
cat >"$work/latest-mac.yml" <<EOF
version: $version
files:
  - url: $url
    sha512: $sha512
    size: $size
path: $url
sha512: $sha512
releaseDate: '$released'
EOF

if [ "$dry_run" = 1 ]; then
  cat "$work/latest-mac.yml"
  exit 0
fi
if ! gh release view nightly -R "$repo" >/dev/null 2>&1; then
  gh release create nightly -R "$repo" --prerelease --latest=false \
    --title 'Orca @dLux Nightly update feed' \
    --notes 'The update feed of Orca @dLux Nightly. The Nightly app reads latest-mac.yml from here. Download a Nightly build from its own release.'
fi
gh release upload nightly "$work/latest-mac.yml" -R "$repo" --clobber
echo "nightly feed: $version"
