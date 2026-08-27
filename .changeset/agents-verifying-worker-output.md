---
"@sma1lboy/rove": patch
---

New internal doc `docs/agents/verifying-worker-output.md`: what a coordinator
does after a worker reports `succeeded`.

The verification workflow existed only as one night's lived experience —
verify the branch exists and holds commits before trusting the report,
cherry-pick past checkout debris in the diff, prove tests can fail by
reverting the fix, triage red CI into regression/flake/hang/stale-green,
treat brief facts as claims, accept skipping as an outcome, and never endorse
numbers you couldn't reproduce. Internal to `docs/agents/`; not synced to the
docs site.
