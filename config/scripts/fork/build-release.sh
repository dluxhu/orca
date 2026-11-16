#!/usr/bin/env bash
# Builds an "Orca @dLux" release on an upstream stable tag. See docs/fork/PATCHES.md "Release steps".
#
# Usage: config/scripts/fork/build-release.sh [--base <tag>] [--version <version>]
#                                             [--remote <name>] [--upstream <name>]
#
# 1. Fetches the tags of the upstream remote (default `upstream`). The base is the newest
#    stable tag (vX.Y.Z), or the stable tag given with --base.
# 2. The version is <base version>-dlux.<N>. N is 1 more than the highest N of an existing
#    v<base version>-dlux.<N> tag. --version overrides it.
# 3. Reads the release order from the "## Release order" list in docs/fork/PATCHES.md of the
#    top patch branch (FORK_PATCHES_REF, default dlux/fork-setup).
# 4. Makes release/<version> from the base in a new worktree, applies each patch branch in
#    that order as one commit (its diff from the stable commit it is based on, by a 3-way
#    cherry-pick; a stacked branch's diff is from the earlier branches it contains), tags
#    v<version>, and moves the local release/latest. It warns when a branch does not contain
#    the base tag.
# It never pushes. With --remote <name>, it reads the patch branches from <name>/.
set -euo pipefail

die() {
  echo "build-release: $*" >&2
  exit 1
}

base_tag=''
version=''
prefix=''
upstream=upstream
while [ $# -gt 0 ]; do
  case $1 in
    --base | --version | --remote | --upstream)
      [ -n "${2:-}" ] || die "$1 needs a value"
      case $1 in
        --base) base_tag=$2 ;;
        --version) version=$2 ;;
        --remote) prefix="$2/" ;;
        --upstream) upstream=$2 ;;
      esac
      shift 2
      ;;
    *) die "unknown argument: $1 (usage: $0 [--base <tag>] [--version <version>] [--remote <name>] [--upstream <name>])" ;;
  esac
done

repo=$(git rev-parse --show-toplevel)
cd "$repo"
[ -z "$(git status --porcelain)" ] || die 'the working tree is not clean; commit or remove the changes first'
# The release commits and tag go to a public repo: a machine address must not leak.
# `git var` gives the identity git really uses, after config levels and environment overrides.
for ident in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do
  value=$(git var "$ident" 2>/dev/null || true)
  case $value in
    *@users.noreply.github.com\>*) ;;
    *) die "$ident is '${value:-unset}'; use a GitHub noreply address (git config user.email <id>+<login>@users.noreply.github.com, and no other author or committer email)" ;;
  esac
done

# Upstream stable tags are vX.Y.Z. Prerelease, android-v* and mobile-* tags are not stable.
stable_re='^v[0-9]+\.[0-9]+\.[0-9]+$'
git fetch --quiet --tags "$upstream" || die "cannot fetch the tags of remote '$upstream'"
if [ -z "$base_tag" ]; then
  base_tag=$(git tag -l 'v*' | grep -E "$stable_re" | sort -V | tail -n 1 || true)
  [ -n "$base_tag" ] || die "no stable tag (vX.Y.Z) found"
fi
[[ $base_tag =~ $stable_re ]] || die "not a stable tag: $base_tag (a stable tag is vX.Y.Z)"
git rev-parse -q --verify "refs/tags/$base_tag" >/dev/null || die "tag not found: $base_tag"

if [ -z "$version" ]; then
  last=$(git tag -l "$base_tag-dlux.*" | sed -nE "s/^${base_tag//./\\.}-dlux\.([0-9]+)$/\1/p" | sort -n | tail -n 1 || true)
  version="${base_tag#v}-dlux.$((${last:-0} + 1))"
fi
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "not a version: $version"

release_branch="release/$version"
tag="v$version"
git rev-parse -q --verify "refs/heads/$release_branch" >/dev/null && die "$release_branch exists"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag exists"
[ "$(git config --bool rerere.enabled || true)" = 'true' ] ||
  echo 'build-release: note: rerere is off; run `git config rerere.enabled true`' >&2

patches_ref="${prefix}${FORK_PATCHES_REF:-dlux/fork-setup}"
patches_file="${patches_ref}:docs/fork/PATCHES.md"
branch_text=$(git show "$patches_file" |
  awk '/^## Release order/{on=1; next} /^## /{on=0} on' |
  sed -nE 's/^[0-9]+\. `([^`]+)`.*/\1/p')
# Read one branch per line into an array; this works in bash and in zsh.
branches=()
while IFS= read -r line; do
  [ -n "$line" ] && branches+=("$line")
done <<EOF_BRANCHES
$branch_text
EOF_BRANCHES
[ ${#branches[@]} -gt 0 ] || die "no \"## Release order\" list in $patches_file"

for branch in "${branches[@]}"; do
  git rev-parse -q --verify "${prefix}${branch}^{commit}" >/dev/null || die "branch not found: ${prefix}${branch}"
done

tmp_root=${TMPDIR:-/tmp}
worktree=$(mktemp -d "${tmp_root%/}/orca-release-$version.XXXXXX")
git worktree add -q -b "$release_branch" "$worktree" "$base_tag^{commit}"
cleanup="Clean up: git worktree remove --force '$worktree'; git branch -D '$release_branch'"
echo "build-release: $release_branch from $base_tag ($(git rev-parse --short "$base_tag^{commit}")) in $worktree"

applied=()
for branch in "${branches[@]}"; do
  ref="${prefix}${branch}"
  sha=$(git rev-parse --short "$ref")
  # Patch branches are based on the stable line. The patch is the branch's own change: its
  # diff from the stable commit it is based on. A commit with the branch tree on that commit
  # gives a 3-way cherry-pick with rename detection and rerere.
  if ! git merge-base --is-ancestor "$base_tag^{commit}" "$ref"; then
    echo "build-release: warning: $ref is not based on $base_tag; merge the tag into the branch" >&2
  fi
  patch_base=$(git merge-base "$base_tag^{commit}" "$ref")
  # A stacked branch contains earlier branches of the release order. Its patch is its diff from
  # all of them merged, so their changes are not applied twice.
  for earlier in ${applied[@]+"${applied[@]}"}; do
    # Only the part of the earlier branch that this branch contains: an older commit of it
    # must not bring back what its tip removed.
    earlier=$(git merge-base "$earlier" "$ref") || continue
    if git merge-base --is-ancestor "$patch_base" "$earlier"; then
      patch_base=$earlier
    elif ! git merge-base --is-ancestor "$earlier" "$patch_base"; then
      # On a conflict, keep the tree with its markers: the branch already resolved it, so the
      # 3-way pick stops only where the release really differs.
      tree=$(git merge-tree --write-tree "$patch_base" "$earlier" | head -n 1 || true)
      [ -n "$tree" ] || die "cannot merge the branches that $ref contains. $cleanup"
      patch_base=$(git commit-tree "$tree" -p "$patch_base" -p "$earlier" \
        -m "stack base of $branch")
    fi
  done
  applied+=("$(git rev-parse "$ref")")
  if git diff --quiet "$patch_base" "$ref"; then
    echo "build-release: $ref ($sha) adds nothing; skipped"
    continue
  fi
  pick=$(git commit-tree "$ref^{tree}" -p "$patch_base" -m "patch $branch")
  merged=yes
  # rerere.autoUpdate stages a conflict that rerere resolved from an earlier run.
  git -C "$worktree" -c rerere.autoUpdate=true cherry-pick --no-commit "$pick" >/dev/null 2>&1 || merged=no
  if [ -n "$(git -C "$worktree" diff --name-only --diff-filter=U)" ]; then
    echo "build-release: CONFLICT while applying $ref ($sha) onto $base_tag." >&2
    git -C "$worktree" diff --name-only --diff-filter=U | sed 's/^/  conflict: /' >&2
    echo "To fix it: merge $base_tag into $branch and resolve there (then push the branch), or" >&2
    echo "  fix the files in the worktree and run: git -C '$worktree' rerere" >&2
    echo "  rerere records the fix. Clean up as below and run this script again." >&2
    echo "$cleanup" >&2
    exit 1
  fi
  if git -C "$worktree" diff --cached --quiet; then
    if [ "$merged" = no ]; then
      echo "build-release: applying $ref ($sha) failed with nothing staged; see: git -C '$worktree' cherry-pick --no-commit $pick" >&2
      echo "$cleanup" >&2
      exit 1
    fi
    echo "build-release: $ref ($sha) adds nothing; skipped"
    continue
  fi
  git -C "$worktree" cherry-pick --quit >/dev/null 2>&1 || true
  git -C "$worktree" commit --quiet --no-verify -m "release $version: $branch ($sha)"
  echo "build-release: applied $ref ($sha) -> $(git -C "$worktree" rev-parse --short HEAD)"
done

git -C "$worktree" tag -a "$tag" -m "Orca @dLux $version (upstream $base_tag)"
echo "build-release: tagged $tag at $(git rev-parse --short "$tag^{commit}")"
# release/latest is the default branch on GitHub. Only this script moves it.
git branch -f release/latest "$tag^{commit}"
echo "build-release: release/latest -> $(git rev-parse --short release/latest)"
remote=${prefix%/}
remote=${remote:-origin}
echo "build-release: nothing is pushed. Worktree: $worktree"
echo "To publish, on the owner's go-ahead:"
echo "  git push $remote $release_branch $tag"
echo "  git push --force-with-lease $remote release/latest"
