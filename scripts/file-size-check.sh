#!/usr/bin/env bash
# File-size cap on touched code files (AGENTS.md "File size cap"), run by
# the CI file-size-cap job. Lives as a script so the gate's behavior is
# testable — see packages/kobe/test/architecture/file-size-check.test.ts.
#
# Env contract (set by ci.yml):
#   BASE_REF — the PR base branch; touched files are diffed against
#              origin/$BASE_REF...HEAD.
#   PR_BODY  — the PR body; `file-size-exemption: <path> — <reason>` lines
#              exempt only the exact path each names.
set -u

CAP=500
# Tunable headroom threshold: a passing file at or past this many lines gets
# a warning (never a failure). The cap alone is a cliff — a file at 499
# passes and the NEXT person to touch it inherits a refactor they did not
# plan, with no room left even to extract a helper.
WARN_AT=470

exempt_paths=$(printf '%s\n' "${PR_BODY-}" | grep -io 'file-size-exemption:[[:space:]]*[^[:space:]]*' | sed 's/^[^:]*:[[:space:]]*//' || true)
fail=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in
    refs/*|*.snap|*fixtures/*|*.lock|*.lockb) continue ;;
  esac
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs) ;;
    *) continue ;;
  esac
  lines=$(wc -l < "$f")
  if [ "$lines" -gt "$CAP" ]; then
    if [ -n "$exempt_paths" ] && printf '%s\n' "$exempt_paths" | grep -qxF "$f"; then
      echo "::notice file=$f::$f is $lines lines but exempted by the PR body."
      continue
    fi
    echo "::error file=$f::$f is $lines lines (cap ~$CAP). Refactor/split it, or add a 'file-size-exemption: $f — <reason>' line to the PR body. See AGENTS.md 'File size cap'."
    fail=1
  elif [ "$lines" -ge "$WARN_AT" ]; then
    echo "::warning file=$f::$f is $lines lines — $((CAP - lines)) from the ~$CAP cap. Consider splitting it now; the next edit may have no room left."
  fi
done < <(git diff --name-only --diff-filter=ACMR "origin/$BASE_REF"...HEAD)
exit $fail
