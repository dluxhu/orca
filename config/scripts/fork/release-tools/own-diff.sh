#!/usr/bin/env bash
# Usage: own-diff.sh save <tag> <dir> [branch...]
#        own-diff.sh compare <before dir> <after dir>
# A merge of a new tag must keep each branch's own change. "save" writes the diff of each branch
# (default: the release order) from the tag it is based on, origin/dlux/<branch>, to <dir>/<branch>.diff.
# Save before the merges (with the old tag) and after them (with the new tag), then "compare"
# prints SAME or DIFF for each branch, ignoring index lines and hunk positions.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
case ${1:-} in
  save)
    tag=${2:?tag} dir=${3:?dir}; shift 3
    mkdir -p "$dir"
    for b in ${*:-$(release_order)}; do git diff "$tag" "origin/dlux/$b" >"$dir/$b.diff" || exit 1; done
    echo "saved $(ls "$dir" | wc -l | tr -d ' ') diffs in $dir" ;;
  compare)
    before=${2:?before dir} after=${3:?after dir} rc=0
    norm() { grep -v '^index ' "$1" | sed -E 's/^@@ [^@]* @@/@@/'; }
    for f in "$after"/*.diff; do
      b=$(basename "$f" .diff)
      [ -f "$before/$b.diff" ] || { echo "NEW $b"; continue; }
      if d=$(diff <(norm "$before/$b.diff") <(norm "$f")); then echo "SAME $b"
      else echo "DIFF $b: $(printf '%s\n' "$d" | grep -c '^[<>]') lines"; printf '%s\n' "$d" >"$after/$b.cmp"; rc=1; fi
    done
    exit $rc ;;
  *) sed -n '2,3p' "$0" >&2; exit 64 ;;
esac
