#!/usr/bin/env bash
# Usage: merge-all.sh <new tag> <old tag> [--plan] [--from <branch>]
# PATCHES.md "Steps for a new upstream stable tag", step 3: merges the new tag into each branch of
# the release order with merge.sh, each branch after the branches it is based on (the "Base"
# cell of its table row). A branch on `upstream-stable` merges <new tag> with base <old tag>; a
# stacked branch merges its (already updated) base branches, each with its old head as base.
# Each branch needs a worktree with it checked out. Stops at the first failure: resolve, commit,
# then run again with --from <that branch>. Pushes nothing.
# --plan prints the merges and changes nothing.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
[ $# -ge 2 ] || { sed -n '2p' "$0" >&2; exit 64; }
new=$1 old=$2; shift 2
plan_only=0 from=
while [ $# -gt 0 ]; do
  case $1 in
    --plan) plan_only=1 ;;
    --from) from=${2:?--from needs a branch}; shift ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
  shift
done
plan=$(merge_plan) || exit 1
[ -n "$plan" ] || { echo "no release order in PATCHES.md" >&2; exit 1; }
printf '%s\n' "$plan" | while read -r name bases; do
  [ -n "$from" ] && [ "$name" != "$from" ] && continue; from=
  if [ -z "$bases" ]; then pairs="$new@$old"; else pairs=$(printf 'dlux/%s ' $bases); fi
  if [ $plan_only -eq 1 ]; then echo "$name <- $pairs"; continue; fi
  wt=$(branch_worktree "$name")
  [ -n "$wt" ] || { echo "no worktree has dlux/$name: git worktree add <path> dlux/$name" >&2; exit 1; }
  # shellcheck disable=SC2086
  "$here/merge.sh" "$name" "$wt" $pairs || { echo "STOPPED at $name"; exit 1; }
done
