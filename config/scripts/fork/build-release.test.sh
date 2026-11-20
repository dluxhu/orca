#!/usr/bin/env bash
# Self-test for build-release.sh. Each case builds a release in a new temp repo.
# Run: config/scripts/fork/build-release.test.sh
# BUILD_RELEASE=<path> tests another copy of the script.
set -euo pipefail

script=${BUILD_RELEASE:-$(cd "$(dirname "$0")" && pwd)/build-release.sh}
root=$(mktemp -d "${TMPDIR:-/tmp}/build-release-test.XXXXXX")
trap 'rm -rf "$root"' EXIT
export GIT_AUTHOR_NAME=test GIT_COMMITTER_NAME=test
export GIT_AUTHOR_EMAIL=1+test@users.noreply.github.com
export GIT_COMMITTER_EMAIL=1+test@users.noreply.github.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
failures=0

# A repo with tag v1.0.0, a bare "upstream" remote that has the tag, and rerere on.
new_repo() {
  repo="$root/$1"
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  git -C "$repo" config rerere.enabled true
  printf 'one\ntwo\nthree\n' >"$repo/f.txt"
  git -C "$repo" add f.txt
  git -C "$repo" commit -q -m base
  git -C "$repo" tag v1.0.0
  git init -q --bare "$root/$1-upstream.git"
  git -C "$repo" remote add upstream "$root/$1-upstream.git"
  git -C "$repo" push -q upstream v1.0.0
}

# commit <branch> <message> <file> [content]: writes the file (content absent: removes it).
commit() {
  git -C "$repo" checkout -q "$1"
  if [ $# -ge 4 ]; then
    printf '%s' "$4" >"$repo/$3"
    git -C "$repo" add "$3"
  else
    git -C "$repo" rm -q "$3"
  fi
  git -C "$repo" commit -q -m "$2"
}

# order <branch>...: the fork-setup branch lists the release order; it is always last.
order() {
  git -C "$repo" checkout -q -b dlux/fork-setup v1.0.0
  mkdir -p "$repo/docs/fork"
  {
    echo '## Release order'
    echo
    n=1
    for b in "$@" dlux/fork-setup; do echo "$n. \`$b\` - test"; n=$((n + 1)); done
    echo
    echo '## End'
  } >"$repo/docs/fork/PATCHES.md"
  git -C "$repo" add docs
  git -C "$repo" commit -q -m patches
}

# build <version> [base]: runs the script; the release tree is at tag v<version>.
build() {
  (cd "$repo" && TMPDIR="$root" "$script" --base "${2:-v1.0.0}" --version "$1") \
    >"$root/out.txt" 2>&1
}

check() {
  if eval "$2"; then
    echo "ok: $1"
  else
    echo "FAIL: $1"
    sed 's/^/  /' "$root/out.txt"
    failures=$((failures + 1))
  fi
}

# 1. Plain branches, not stacked.
new_repo plain
git -C "$repo" checkout -q -b dlux/a v1.0.0
commit dlux/a 'a adds a' a.txt 'a'
git -C "$repo" checkout -q -b dlux/b v1.0.0
commit dlux/b 'b adds b' b.txt 'b'
order dlux/a dlux/b
build 1.0.0-dlux.1 || true
check 'plain branches are all applied' \
  '[ "$(git -C "$repo" ls-tree --name-only -r v1.0.0-dlux.1 | grep -vc docs/)" = 3 ]'

# 2. A stack built on an older commit of an earlier branch keeps what the tip removed out.
new_repo older
git -C "$repo" checkout -q -b dlux/a v1.0.0
commit dlux/a 'a adds x' x.txt 'x'
git -C "$repo" branch -q dlux/s
commit dlux/a 'a adds a' a.txt 'a'
commit dlux/a 'a removes x' x.txt
commit dlux/s 's adds s' s.txt 's'
order dlux/a dlux/s
build 1.0.0-dlux.1 || true
check 'a stack on an older commit does not bring back a removed file' \
  'git -C "$repo" rev-parse -q --verify v1.0.0-dlux.1 >/dev/null &&
   ! git -C "$repo" cat-file -e v1.0.0-dlux.1:x.txt 2>/dev/null &&
   git -C "$repo" cat-file -e v1.0.0-dlux.1:a.txt &&
   git -C "$repo" cat-file -e v1.0.0-dlux.1:s.txt'

# 3. A stack that merged two conflicting branches. Its merge records the resolution (rerere),
#    and the release replays it when it applies the second branch.
new_repo conflict
resolved=$'one\nP and Q\nthree\n'
git -C "$repo" checkout -q -b dlux/p v1.0.0
commit dlux/p 'p' f.txt $'one\nP\nthree\n'
git -C "$repo" checkout -q -b dlux/q v1.0.0
commit dlux/q 'q' f.txt $'one\nQ\nthree\n'
git -C "$repo" checkout -q -b dlux/s dlux/p
git -C "$repo" merge -q dlux/q -m 'merge q' >/dev/null 2>&1 || true
printf '%s' "$resolved" >"$repo/f.txt"
git -C "$repo" add f.txt
git -C "$repo" commit -q --no-edit >/dev/null 2>&1
commit dlux/s 's adds s' s.txt 's'
order dlux/p dlux/q dlux/s
build 1.0.0-dlux.1 || true
check 'a stack of two conflicting branches applies after the release resolved them' \
  'git -C "$repo" rev-parse -q --verify v1.0.0-dlux.1 >/dev/null &&
   [ "$(git -C "$repo" show v1.0.0-dlux.1:f.txt)" = "$(printf "%s" "$resolved")" ] &&
   git -C "$repo" cat-file -e v1.0.0-dlux.1:s.txt'

# 4. The weekly tag merge makes a criss-cross: the earlier tip and the stack both merge a new
#    tag, so the stack has two best bases with the earlier tip. The tip removed x; the stack
#    still has it from an older commit. The release must not bring x back.
new_repo crisscross
git -C "$repo" checkout -q -b dlux/a v1.0.0
commit dlux/a 'a adds x' x.txt 'x'
git -C "$repo" branch -q dlux/s
commit dlux/s 's adds s' s.txt 's'
commit main 'upstream adds m' m.txt 'm'
git -C "$repo" tag v1.1.0
git -C "$repo" push -q upstream v1.1.0
commit dlux/a 'a removes x' x.txt
git -C "$repo" merge -q --no-edit v1.1.0 >/dev/null
git -C "$repo" checkout -q dlux/s
git -C "$repo" merge -q --no-edit v1.1.0 >/dev/null
order dlux/a dlux/s
build 1.1.0-dlux.1 v1.1.0 || true
check 'a criss-cross stack does not bring back what the earlier tip removed' \
  'git -C "$repo" rev-parse -q --verify v1.1.0-dlux.1 >/dev/null &&
   ! git -C "$repo" cat-file -e v1.1.0-dlux.1:x.txt 2>/dev/null &&
   git -C "$repo" cat-file -e v1.1.0-dlux.1:m.txt &&
   git -C "$repo" cat-file -e v1.1.0-dlux.1:s.txt'

# 5. --nightly builds on an upstream commit that is not a tag, adds the nightly identity commit,
#    and leaves release/latest alone.
new_repo nightly
commit main 'upstream nightly' n.txt 'n'
nightly_sha=$(git -C "$repo" rev-parse main)
git -C "$repo" checkout -q -b nightly/a v1.0.0
commit nightly/a 'a adds a' a.txt 'a'
git -C "$repo" merge -q --no-edit "$nightly_sha" >/dev/null
order dlux/a
git -C "$repo" checkout -q -b nightly/fork-setup dlux/fork-setup
mkdir -p "$repo/src/shared/remote" "$repo/src/renderer"
printf "const FORK_CHANNEL = 'stable' as 'stable' | 'nightly'\n" >"$repo/src/shared/fork-identity.ts"
printf '{ "appId": "com.stablyai.orca.dlux" }\n' >"$repo/src/shared/remote/local-build-compatibility-contract.json"
printf '<title>Orca @dLux</title>\n' >"$repo/src/renderer/index.html"
git -C "$repo" add src
git -C "$repo" commit -q -m 'fork identity'
git -C "$repo" merge -q --no-edit "$nightly_sha" >/dev/null
(cd "$repo" && TMPDIR="$root" "$script" --nightly "$nightly_sha" --version 1.1.0-daily.1-dlux.1) \
  >"$root/out.txt" 2>&1 || true
check 'a nightly build has the patches, the nightly identity, and no release/latest' \
  'git -C "$repo" cat-file -e v1.1.0-daily.1-dlux.1:n.txt &&
   git -C "$repo" cat-file -e v1.1.0-daily.1-dlux.1:a.txt &&
   git -C "$repo" show v1.1.0-daily.1-dlux.1:src/shared/fork-identity.ts | grep -q "FORK_CHANNEL = '"'"'nightly'"'"'" &&
   git -C "$repo" show v1.1.0-daily.1-dlux.1:src/shared/remote/local-build-compatibility-contract.json | grep -q dlux.nightly &&
   git -C "$repo" show v1.1.0-daily.1-dlux.1:src/renderer/index.html | grep -q "Orca @dLux Nightly" &&
   ! git -C "$repo" rev-parse -q --verify release/latest >/dev/null'
(cd "$repo" && TMPDIR="$root" "$script" --nightly "$nightly_sha") >"$root/out.txt" 2>&1 &&
  nightly_no_version=ran || nightly_no_version=refused
check 'a nightly build without --version is refused' '[ "$nightly_no_version" = refused ]'

[ "$failures" = 0 ] || { echo "$failures case(s) failed"; exit 1; }
echo 'all cases passed'
