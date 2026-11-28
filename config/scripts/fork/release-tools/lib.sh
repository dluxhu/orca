# Shared helpers of the release scripts. Source it: . "$(dirname "$0")/lib.sh"
# PATCHES.md is read from FORK_PATCHES_REF (default dlux/fork-setup), as build-release.sh does.
# PATCHES_FILE=<path> reads a file instead (the self-test uses it).

patches_md() {
  if [ -n "${PATCHES_FILE:-}" ]; then cat "$PATCHES_FILE"
  else git show "${FORK_PATCHES_REF:-dlux/fork-setup}:docs/fork/PATCHES.md"; fi
}

# The "## Release order" list, one branch name (without dlux/) per line.
release_order() {
  patches_md | awk '/^## Release order/{on=1; next} /^## /{on=0} on' |
    sed -nE 's/^[0-9]+\. `dlux\/([^`]+)`.*/\1/p'
}

# One line per branch, in merge order (each branch after the branches it is based on):
# "<branch> <base branch>..." with no base branch for one on `upstream-stable`.
# The bases come from the "Base" cell of the branch's table row.
merge_plan() {
  local rows order done_list="" left name bases b ok progress
  rows=$(patches_md | sed -nE 's/^\| `dlux\/([^`]+)` *\| *([^|]*)\|.*/\1 \2/p' |
    while read -r name cell; do
      printf '%s' "$name"
      printf '%s\n' "$cell" | grep -oE 'dlux/[a-z0-9-]+' | sed 's|^dlux/| |' | tr -d '\n'
      echo
    done)
  order=$(release_order)
  left=$order
  while [ -n "$left" ]; do
    progress=0
    for name in $left; do
      bases=$(printf '%s\n' "$rows" | awk -v b="$name" '$1==b{$1=""; print}')
      ok=1
      for b in $bases; do
        printf '%s\n' "$order" | grep -qx "$b" || { echo "merge_plan: $name is based on $b, which is not in the release order" >&2; return 1; }
        printf ' %s ' "$done_list" | grep -q " $b " || ok=0
      done
      [ $ok -eq 1 ] || continue
      echo "$name$bases" | tr -s ' '
      done_list="$done_list $name"
      left=$(printf '%s\n' $left | grep -vx "$name" || true)
      progress=1
    done
    [ $progress -eq 1 ] || { echo "merge_plan: a base loop among: $left" >&2; return 1; }
  done
}

# The worktree that has dlux/<branch> checked out, or nothing.
branch_worktree() {
  git worktree list --porcelain | awk -v ref="branch refs/heads/dlux/$1" '
    /^worktree /{wt=substr($0, 10)} $0==ref{print wt; exit}'
}

# Puts NODE_BIN_DIR (a Node 24 bin folder) first in PATH when it is set.
use_node() {
  [ -z "${NODE_BIN_DIR:-}" ] || export PATH="$NODE_BIN_DIR:$PATH"
  case "$(node --version 2>/dev/null)" in v24.*) ;; *)
    echo "Node 24 is needed (package.json engines); set NODE_BIN_DIR: $(node --version 2>&1)" >&2; return 1 ;; esac
}
