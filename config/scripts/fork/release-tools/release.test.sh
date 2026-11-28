#!/usr/bin/env bash
# Self-test of the release helpers: the merge plan from a PATCHES.md, and merge.sh with an
# explicit merge base. Run: config/scripts/fork/release-tools/release.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/release-test.XXXXXX")
trap 'rm -rf "$root"' EXIT
export GIT_AUTHOR_NAME=test GIT_COMMITTER_NAME=test
export GIT_AUTHOR_EMAIL=1+test@users.noreply.github.com GIT_COMMITTER_EMAIL=1+test@users.noreply.github.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
failures=0
expect() { # <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok $1"; else echo "FAIL $1"; diff <(echo "$2") <(echo "$3") || true; failures=$((failures + 1)); fi
}

# 1. The plan: each branch after its bases (a glue branch listed before its second base moves
#    after it); a cell with "(+ ...)" names extra bases.
cat >"$root/PATCHES.md" <<'MD'
## Release order

1. `dlux/a` - root.
2. `dlux/glue` - glue of a and b.
3. `dlux/b` - root.
4. `dlux/c` - on b.
5. `dlux/setup` - on a and c.

| Branch | Base | Kind |
| --- | --- | --- |
| `dlux/a` | `upstream-stable` | x |
| `dlux/glue` | `dlux/a` + `dlux/b` | glue |
| `dlux/b` | `upstream-stable` | x |
| `dlux/c` | `dlux/b` | x |
| `dlux/setup` | `upstream-stable` (+ `dlux/a`, `dlux/c`) | x |
MD
got=$(PATCHES_FILE="$root/PATCHES.md" bash -c '. "$1/lib.sh"; merge_plan' _ "$here")
expect "merge plan order" "a
b
c b
setup a c
glue a b" "$got"
got=$(PATCHES_FILE="$root/PATCHES.md" bash -c '. "$1/lib.sh"; release_order | tr "\n" " "' _ "$here")
expect "release order" "a glue b c setup " "$got"
printf '| `dlux/d` | `dlux/missing` | x |\n6. `dlux/d` - on missing.\n' >>"$root/PATCHES.md"
if PATCHES_FILE="$root/PATCHES.md" bash -c '. "$1/lib.sh"; merge_plan' _ "$here" >/dev/null 2>&1; then
  echo "FAIL a base outside the release order is refused"; failures=$((failures + 1))
else echo "ok a base outside the release order is refused"; fi

# 2. merge.sh with base = old tag: the new tag is on its own release line, without the old tag's
#    stable-only commit. The merge keeps the branch change and takes the new tag's file.
repo=$root/repo
git init -q -b main "$repo"
cd "$repo"
printf 'one\n' >f.txt; printf 'x\n' >g.txt; git add .; git commit -q -m base
git checkout -q -b line1; printf 'one-stable\n' >f.txt; git commit -qam stable-only; git tag v1.0.0
git checkout -q main; printf 'x2\n' >g.txt; git commit -qam upstream; git tag v1.1.0
git checkout -q -b dlux/p v1.0.0; printf 'p\n' >p.txt; git add p.txt; git commit -q -m patch
git init -q --bare "$root/origin.git"; git remote add origin "$root/origin.git"; git push -q origin dlux/p
git fetch -q origin
"$here/merge.sh" p "$repo" v1.1.0@v1.0.0 >/dev/null
expect "merge keeps the patch" "p" "$(cat p.txt)"
expect "merge takes the new tag's change" "x2" "$(cat g.txt)"
expect "merge drops the old stable-only commit" "one" "$(cat f.txt)"
expect "merge has two parents" "2" "$(git rev-list --parents -n1 HEAD | wc -w | awk '{print $1 - 1}')"
expect "a contained source is skipped" "contains v1.1.0: dlux/p" "$("$here/merge.sh" p "$repo" v1.1.0@v1.0.0)"

[ $failures -eq 0 ] && echo "release.test.sh: all passed" || { echo "release.test.sh: $failures failed"; exit 1; }
