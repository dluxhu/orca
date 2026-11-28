#!/usr/bin/env bash
# Usage: combine.sh <tag> <check worktree>
# The combined check tree: detaches <check worktree> at <tag>, then merges each branch of the
# release order (local dlux/* refs; heads.sh shows that they match origin) as a --no-ff merge.
# Run the checks on it (checks.sh). The tree of the release that build-release.sh makes must be
# the same tree: git diff --quiet <combined> release/<version>.
# RESUME=1 goes on from the current HEAD after a fixed conflict. A conflict that rerere replays
# is staged when no marker is left. Local only: no hooks run, nothing is pushed.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
[ $# -eq 2 ] || { sed -n '2p' "$0" >&2; exit 64; }
tag=$1
order=$(release_order) || exit 1
cd "$2" || exit 1
[ -z "$(git status --short)" ] || { echo "dirty $2" >&2; exit 1; }
[ "${RESUME:-}" = 1 ] || git checkout -q --detach "$tag" || exit 1
for b in $order; do
  if git merge-base --is-ancestor "dlux/$b" HEAD; then echo "contained $b"; continue; fi
  if ! git -c core.hooksPath=/dev/null merge -q --no-ff --no-edit -m "Merge dlux/$b" "dlux/$b" >/dev/null 2>&1; then
    left=$(git diff --name-only --diff-filter=U)
    # shellcheck disable=SC2086
    if [ -n "$left" ] && ! grep -lE '^(<<<<<<<|>>>>>>>) ' $left >/dev/null; then git add -- $left; left=; fi
    if [ -z "$left" ]; then git -c core.hooksPath=/dev/null commit -q --no-edit && echo "merged $b (rerere)" && continue; fi
    echo "CONFLICT $b:"; echo "$left"; exit 1
  fi
  echo "merged $b"
done
echo "combined $(git rev-parse --short=11 HEAD) tree $(git rev-parse --short=11 'HEAD^{tree}')"
