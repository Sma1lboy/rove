---
"@sma1lboy/rove": patch
---

`rove api --repo ssh://…`, safer worktree deletion, and five smaller correctness fixes

- `--repo` accepts a remote project's `ssh://…` key. Every `--repo` flag resolved its value as a filesystem path, so the key collapsed to `$PWD/ssh:/me@host/srv/proj` and the task was filed against a directory nobody typed. `savedRepos` stores the key verbatim and `resolveRepoRoot` already passes it through — the CLI's path resolution was the only thing in the way.
- A worktrees-location override no longer authorizes deleting your other projects. Rove only ever creates `<root>/<repo-key>/<slug>`, but the guard in front of the `rm -rf` for an unrecoverable worktree accepted anything at any depth below the root — so pointing Settings → Worktree location at `~` or `~/code` made every unrelated project below it answer "yes, Rove made this".
- One vanished worktree no longer blanks the whole sidebar. The dirty probe ran without the try/catch its sibling activity probe has, so a worktree removed between the listing and the probe threw out of the whole call instead of costing one row.
- Landing refuses a task that is already being deleted, the way every other worktree entry point does, instead of racing the daemon's deletion runner over the same directory.
- Clearing a task's recorded worktree path no longer applies to `dir` tasks, whose path is the user's own directory rather than a Rove-created worktree — blanking it left the task unable to open anything.
- Closing a viewport tab (one mirroring another task's session) no longer kills that task's split panes. The borrowed base was correctly spared; its `::leaf-N` children were not.
- Automation runs that were `revived` or `deferred` no longer render in the same grey as "nothing to do" — both delivered the prompt somewhere, and `deferred` reads as a warning because it is parked until you release it from the Inbox.
