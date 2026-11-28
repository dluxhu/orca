#!/usr/bin/env bash
# Usage: heads.sh [tag]
# For each branch of the release order: origin head, local head, whether origin has the tag
# (default: the newest local v*.*.* stable tag), and its worktree.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
tag=${1:-$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)}
for b in $(release_order); do
  o=$(git rev-parse -q --verify --short=11 "origin/dlux/$b" || echo none)
  l=$(git rev-parse -q --verify --short=11 "dlux/$b" || echo none)
  git merge-base --is-ancestor "$tag" "origin/dlux/$b" 2>/dev/null && c=has || c=no
  wt=$(branch_worktree "$b")
  echo "$b origin=$o local=$l $c-$tag ${wt:-NOWT}"
done
