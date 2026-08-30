---
"@sma1lboy/rove": patch
---

Persist the task brief and fork point on the task record; stop recommending `git stash`

`add --prompt` read the prompt, delivered it into the engine, and dropped it — the only
copy lived in the engine's own transcript, so a dead engine (or lost context) took the
task brief down with it and the only recovery was the user re-pasting it. The prompt is
now recorded on the task record once delivery confirms, and `get-task` returns it as
`.task.prompt` — the brief outlives the session it started in.

`add --base-branch` lived only in an in-memory side-map consumed once at worktree
creation. A daemon restart between create and first enter silently dropped it (the
branch then forked from the guessed base), and `collect`'s ahead/diffstat signals always
measured against a re-guessed `origin/HEAD` → `main` → `master` instead of the real fork
point. `baseRef` is now persisted on the task record; `collect` prefers it and only
falls back to the guess for records that predate the field.

Also: Rove no longer recommends `git stash` anywhere. The stash stack lives in the
repo's common dir (`.git/refs/stash`) and is shared by every linked worktree, so two
parallel tasks that stash can pop or drop each other's work — the one hole in the
"worktree isolation" model. The land-refusal error, the worktrees page copy, the docs,
and the agent skill now say commit instead, and say why.
