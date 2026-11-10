#!/usr/bin/env bash
# Run the full ci.yml suite for main's HEAD and wait for it: the release gate.
# ci.yml has no push trigger (main runs it as a scheduled batch), so a release
# commit gets a run only by asking. An existing run for the same commit, in
# progress or green, is reused instead of dispatching another.
#
#   scripts/ci-run-for-sha.sh <sha>   # exit 0 = green; prints the run id
#
# Honors GH_REPO (set it in Actions). Fails if main moved past <sha>: a
# dispatch always tests main's HEAD, so it could not prove <sha>.
set -euo pipefail

sha=$1
find_run() {
  gh run list --workflow=ci.yml --branch main --limit 30 --json databaseId,headSha,status,conclusion \
    --jq "[.[] | select(.headSha == \"$sha\") | select(.status != \"completed\" or .conclusion == \"success\")][0].databaseId // empty"
}

run_id=$(find_run)
if [ -z "$run_id" ]; then
  head=$(gh api "repos/{owner}/{repo}/commits/main" --jq .sha)
  if [ "$head" != "$sha" ]; then
    echo "error: main is at ${head:0:9}, not ${sha:0:9}; a dispatch would test the wrong commit" >&2
    exit 1
  fi
  echo "dispatching ci.yml on main for ${sha:0:9}" >&2
  gh workflow run ci.yml --ref main >&2
  tries=0
  while [ -z "$run_id" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 36 ]; then
      echo "error: the dispatched ci.yml run did not appear within ~3min" >&2
      exit 1
    fi
    sleep 5
    run_id=$(find_run)
  done
fi

echo "ci.yml run $run_id — watching to completion" >&2
echo "$run_id"
gh run watch "$run_id" --exit-status >/dev/null
