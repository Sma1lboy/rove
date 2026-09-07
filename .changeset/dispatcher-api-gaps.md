---
"@sma1lboy/rove": patch
---

`rove api`: six things a dispatcher could not do

Six gaps found by an agent supervising ten workers through `rove api` for a day.

- **`delete` now reports what happened to the branch.** With `--delete-branch` the reply carries `branch` — `{ branch, deleted, keptReason?, remote? }` — instead of only `status: "removed"`, which is the worktree's outcome and never the branch's. git's refusals (unmerged work, a sibling worktree holding the branch) reached `daemon.log` and nowhere a caller could read them. New `--delete-remote` pushes `git push --delete` to the branch's own remote; it is a separate opt-in that `--delete-branch` never implies, because a remote branch is recoverable by nobody and its deletion closes an open PR.
- **`interrupt`** stops the turn a task's engine is running, using the engine's own interrupt bytes. `send` cannot reach a runaway worker (delivery needs a quiet composer), so the only levers left destroyed something — `tab-close` the conversation, `delete` the worktree. Engines that have not declared an interrupt sequence are refused with `UNSUPPORTED` rather than guessed at.
- **`watch`** blocks until a task's engine reaches a state, streaming every transition as NDJSON — the push-driven replacement for a `collect` polling loop. `dead` is the state polling is worst at: a `SIGKILL`ed engine fires no hook, so the daemon writes it from the PTY exit record and pushes it immediately.
- **`COMPOSER_BUSY` and deferred sends now say what is in the composer.** `composerPreview` carries the blocking text (200 chars); before, a refused caller had to `read-output` the pane to learn whether a worker was mid-sentence or a stray keystroke was sitting there. Response-only — never `daemon.log`, never the Inbox episode.
- **`set-status --report-branch/--report-pr/--report-summary`** records what the worker says it delivered as `.report` on the task, readable from `get-task` and `collect`. Outcomes used to travel as prose a dispatcher parsed by convention. Deliberately not merged with `.prStatus`: one is a claim, the other is what the daemon observed from the forge.
- **`add --worktree-name`** names the worktree directory so a caller can predict `.task.worktreePath` instead of reading it back. A name already in use is refused (`WORKTREE_NAME_TAKEN`), never silently suffixed `-v2`.
