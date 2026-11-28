#!/usr/bin/env bash
# Usage: checks.sh <worktree> <tag> <log dir> [step...]
# The release checks on the combined tree (combine.sh) in <worktree>, against the base <tag>.
# Heavy: run it as one job when the machine has the memory for it. Prints "result: PASS|FAIL".
# Steps (default: all, in this order):
#   install  pnpm install --frozen-lockfile, offline first (a new tag can change the lockfile)
#   vitest   the targeted tests: each test file of the fork diff, the paths of the PATCHES.md
#            "Check" column, src/shared/icon-badger and src/shared/keybindings. TESTS="<paths>"
#            runs those paths instead (a re-check of the failed files).
#   mjs      the .mjs tests of the "Check" column
#   oxlint, oxfmt   lint and format of the fork diff (without mobile/, it has its own config)
#   tc       the node, web and cli typecheck, one at a time
#   l10n     verify:localization-runtime-catalog and verify:localization-extraction
#   skills   test:repro:skills-cli-runtime
#   sh       config/scripts/fork/**/*.test.sh
# NODE_BIN_DIR=<Node 24 bin folder> is put first in PATH.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
[ $# -ge 3 ] || { sed -n '2p' "$0" >&2; exit 64; }
W=$1 TAG=$2 O=$3; shift 3
steps=${*:-install vitest mjs oxlint oxfmt tc l10n skills sh}
cd "$W" || exit 1
use_node || exit 1
export HUSKY=0
unset ORCA_CLI_COMMAND ORCA_CLI_HANDOFF
mkdir -p "$O"
fail=0
want() { case " $steps " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
res() { # <label> <rc> <log>
  echo "$1 exit=$2 ($(($(date +%s) - t0))s)"
  [ "$2" -eq 0 ] || { fail=1; grep -E 'error TS|FAIL|×|Error' "$3" | head -12; }
}
check_paths() { # the paths of the PATCHES.md "Check" column
  grep -oE 'pnpm exec vitest run --config config/vitest.config.ts [^`]*' docs/fork/PATCHES.md |
    sed 's|pnpm exec vitest run --config config/vitest.config.ts ||' | tr ' ' '\n' | grep -E '^(src|config)/'
}
echo "head $(git rev-parse --short=11 HEAD) tree $(git rev-parse --short=11 'HEAD^{tree}') node $(node -v) free $(df -h . | awk 'NR==2{print $4}')"
if want install; then
  t0=$(date +%s)
  pnpm install --frozen-lockfile --offline >"$O/install.log" 2>&1 ||
    pnpm install --frozen-lockfile >>"$O/install.log" 2>&1
  res install $? "$O/install.log"
  git checkout -q -- pnpm-lock.yaml 2>/dev/null
fi
if want vitest; then
  targeted() {
    git diff --name-only --diff-filter=AMR "$TAG" HEAD -- '*.test.ts' '*.test.tsx' | grep -v '^mobile/'
    check_paths | grep -v '\.mjs$'
    echo src/shared/icon-badger
    echo src/shared/keybindings
  }
  T=${TESTS:-$(targeted | sort -u)}
  echo "targeted paths: $(echo "$T" | wc -l | tr -d ' ')"
  t0=$(date +%s)
  # shellcheck disable=SC2086
  pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 --reporter=verbose $T >"$O/vitest.log" 2>&1
  res vitest $? "$O/vitest.log"
  grep -E "Test Files|Tests  " "$O/vitest.log"
fi
if want mjs; then
  M=$(check_paths | grep '\.mjs$' | sort -u)
  if [ -n "$M" ]; then
    t0=$(date +%s)
    # shellcheck disable=SC2086
    pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 $M >"$O/mjs.log" 2>&1
    res mjs $? "$O/mjs.log"
    grep -E "Tests  " "$O/mjs.log"
  fi
fi
F=$(git diff --name-only --diff-filter=AM "$TAG" HEAD -- '*.ts' '*.tsx' '*.mjs' '*.cjs' | grep -v '^mobile/')
if want oxlint; then
  echo "fork diff files: $(echo "$F" | wc -l | tr -d ' ')"
  t0=$(date +%s)
  # shellcheck disable=SC2086
  pnpm exec oxlint $F >"$O/oxlint.log" 2>&1
  res oxlint $? "$O/oxlint.log"
  tail -3 "$O/oxlint.log"
fi
if want oxfmt; then
  t0=$(date +%s)
  # shellcheck disable=SC2086
  pnpm exec oxfmt --check $F >"$O/oxfmt.log" 2>&1
  res oxfmt $? "$O/oxfmt.log"
fi
if want tc; then
  for p in config/tsconfig.node.json config/tsconfig.tc.web.json config/tsconfig.tc.cli.json; do
    l=$O/tc-$(basename "$p" .json).log
    t0=$(date +%s)
    node config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs --project="$p" >"$l" 2>&1
    res "tc $p" $? "$l"
  done
fi
run_script() { local l=$O/$1.log; t0=$(date +%s); pnpm run "$1" >"$l" 2>&1; res "$1" $? "$l"; }
want l10n && { run_script verify:localization-runtime-catalog; run_script verify:localization-extraction; }
want skills && run_script test:repro:skills-cli-runtime
if want sh; then
  for t in config/scripts/fork/*.test.sh config/scripts/fork/*/*.test.sh; do
    [ -f "$t" ] || continue
    l=$O/$(basename "$t").log
    t0=$(date +%s)
    bash "$t" >"$l" 2>&1
    res "$t" $? "$l"
  done
fi
git checkout -q -- pnpm-lock.yaml 2>/dev/null
echo "status: $(git status --short | head -5 | tr '\n' ' ')"
if [ "$fail" -eq 0 ]; then echo "result: PASS"; else echo "result: FAIL"; exit 1; fi
