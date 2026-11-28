#!/usr/bin/env bash
# Usage: merge.sh <branch> <worktree> <source>[@<base>]...
# Merges each source into dlux/<branch> (checked out in <worktree>) as a normal two-parent merge
# commit, with an explicit merge base (git merge-tree --merge-base). Without @<base>, the base is
# the newest commit of the source's first-parent line that the branch has (its old head).
# Why the explicit base: each upstream stable tag is on its own release branch. Merging the new
# tag with the default base would re-apply the old tag's stable-only commits (reverts). With
# base = the old tag, the result is the new tag + the branch's own diff.
# It fast-forwards to origin/dlux/<branch> first, and skips a source the branch contains.
# On a conflict it writes the conflicted tree into the worktree with MERGE_HEAD set and stops:
# fix the files, git add, git commit. It never pushes.
set -uo pipefail
[ $# -ge 3 ] || { sed -n '2p' "$0" >&2; exit 64; }
name=$1 wt=$2; shift 2
cd "$wt" || exit 1
[ "$(git branch --show-current)" = "dlux/$name" ] || { echo "$wt does not have dlux/$name checked out" >&2; exit 1; }
[ -z "$(git status --short)" ] || { echo "dirty $wt" >&2; exit 1; }
git merge --ff-only -q "origin/dlux/$name" || exit 1
for pair in "$@"; do
  src=${pair%@*}
  if git merge-base --is-ancestor "$src" HEAD; then echo "contains $src: dlux/$name"; continue; fi
  if [ "$pair" = "$src" ]; then
    # The newest commit of the source's first-parent line that HEAD has: its old head. git's own
    # merge base can be another branch merged into both (a criss-cross), and then the source's
    # own change conflicts with the resolution that HEAD already has.
    base=$(git rev-list --first-parent "$src" | while read -r c; do
      git merge-base --is-ancestor "$c" HEAD && { echo "$c"; break; }; done)
    [ -n "$base" ] || { echo "no commit of $src is in HEAD" >&2; exit 1; }
  else base=${pair#*@}; fi
  git merge-base --is-ancestor "$base" HEAD || { echo "HEAD lacks base $base" >&2; exit 1; }
  echo "start dlux/$name $(git rev-parse --short=11 HEAD) <- $src (base $(git rev-parse --short=11 "$base"))"
  msg=$(printf "Merge %s into dlux/%s" "$src" "$name")
  [ -z "${MERGE_TRAILER:-}" ] || msg=$(printf '%s\n\n%s' "$msg" "$MERGE_TRAILER")
  out=$(git merge-tree --write-tree --name-only --merge-base="$base" HEAD "$src"); rc=$?
  tree=$(printf '%s\n' "$out" | head -1)
  if [ $rc -eq 0 ]; then
    c=$(git commit-tree "$tree" -p HEAD -p "$src^{commit}" -m "$msg") || exit 1
    git merge --ff-only -q "$c" || exit 1
    echo "done dlux/$name $(git rev-parse --short=11 HEAD)"
    continue
  fi
  [ $rc -eq 1 ] || { echo "merge-tree failed rc=$rc" >&2; exit 1; }
  git read-tree -u -m HEAD "$tree" || exit 1
  git rev-parse "$src^{commit}" >"$(git rev-parse --git-path MERGE_HEAD)"
  printf '%s\n' "$msg" >"$(git rev-parse --git-path MERGE_MSG)"
  printf '%s\n' "$out" | sed -n '2,/^$/p' | grep . | sed 's/^/unmerged: /'
  exit 1
done
