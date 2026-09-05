---
"@sma1lboy/rove": patch
---

Fix five ways a destructive path could lose work without saying so.

- A salvage snapshot built its throwaway index empty, so git treated tracked
  files as untracked and `.gitignore` applied to them. Every uncommitted edit to
  a file the repo tracks and its own `.gitignore` also matches (a committed
  `dist/README.md`, a committed `server.log`) was recorded as a deletion while
  the snapshot reported success. The index is now seeded from HEAD.
- One gitignored file whose name starts with `-` made `du` read it as an option,
  which emptied the ignored-work probe for the whole worktree — so the non-force
  delete gate stopped refusing and `HANDOFF.md` / `.scratch/` were destroyed with
  no snapshot. `du` now gets a `--` terminator, batches under ARG_MAX, and
  measures newline-containing names one at a time.
- Two salvages in the same second wrote the same ref and the second silently
  overwrote the first, though both callers were told their work was saved. The
  write is now create-only, and a non-ASCII branch keeps its name in the ref
  instead of collapsing to `detached`.
- With the "next to project" worktree location, an orphaned worktree (upstream
  `.git` gone) could never be removed: the managed-root guard could not expand
  `$project_dir` without the repo, so the task parked in `deletion.phase: error`
  and every retry re-ran the same unsatisfiable branch.
- `rove theme remove` did not validate the name, so `remove '../../notes'`
  deleted any reachable `.json`. Both `add` and `remove` now share one check.
