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
#   PR_NUMBER, GH_TOKEN, GITHUB_REPOSITORY — optional; when set, the CURRENT
#              body is fetched instead, so editing the description and
#              re-running the job is enough (PR_BODY is the event's frozen
#              snapshot, which `gh run rerun` reuses).
#
# Only growth is gated: an over-cap file fails when this PR made it longer
# (or created it). Touching a file that was already over the cap without
# adding lines — deleting an import, say — is a notice, not a failure.
set -u

CAP=500
# Tunable headroom threshold: a passing file at or past this many lines gets
# a warning (never a failure). The cap alone is a cliff — a file at 499
# passes and the NEXT person to touch it inherits a refactor they did not
# plan, with no room left even to extract a helper.
WARN_AT=470

body=${PR_BODY-}
if [ -n "${PR_NUMBER-}" ] && [ -n "${GH_TOKEN-}" ] && [ -n "${GITHUB_REPOSITORY-}" ]; then
  body=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" -q .body 2>/dev/null || printf '%s' "$body")
fi
base=$(git merge-base "origin/$BASE_REF" HEAD)

exempt_paths=$(printf '%s\n' "$body" | grep -io 'file-size-exemption:[[:space:]]*[^[:space:]]*' | sed 's/^[^:]*:[[:space:]]*//' || true)
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
  lines=$(wc -l < "$f" | tr -d " ")
  if [ "$lines" -gt "$CAP" ]; then
    base_lines=$( (git show "$base:$f" 2>/dev/null || true) | wc -l | tr -d " ")
    if [ "$lines" -le "$base_lines" ]; then
      echo "::notice file=$f::$f is $lines lines (cap ~$CAP) but this PR did not grow it (was $base_lines)."
      continue
    fi
    if [ -n "$exempt_paths" ] && printf '%s\n' "$exempt_paths" | grep -qxF "$f"; then
      echo "::notice file=$f::$f is $lines lines but exempted by the PR body."
      continue
    fi
    echo "::error file=$f::$f is $lines lines (cap ~$CAP). This PR grew it past the cap — split it, or add a 'file-size-exemption: $f — <reason>' line to the PR body. See AGENTS.md 'File size cap'."
    fail=1
  elif [ "$lines" -ge "$WARN_AT" ]; then
    echo "::warning file=$f::$f is $lines lines — $((CAP - lines)) from the ~$CAP cap. Consider splitting it now; the next edit may have no room left."
  fi
done < <(git diff --name-only --diff-filter=ACMR "origin/$BASE_REF"...HEAD)
exit $fail
