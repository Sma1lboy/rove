---
"@sma1lboy/rove": patch
---

Fix six defects on the first-run path

- Creating a task in a repo with no commits failed silently: the dialog accepted a freshly `git init`ed repo, prefilled `main` as the base ref, and `git worktree add` died with `fatal: invalid reference: main` on a path whose only error handler was an invisible `console.error`. The user was left on a new task row that told them to select a task. The dialog now says the repository has no commits yet and hands over the fix.
- Running `rove` from a repo subdirectory created a ghost project: `ensureMainTask` resolved to the git toplevel but the task record kept the raw subdirectory, so the sidebar showed two projects for one repo. `createTask` now normalizes to the git root like `rove add` and `rove api add` already did.
- `rove skill install` crashed with `Executable not found in $PATH: "npx"` when Node was absent. The installer now checks first and explains that Node is required — the `install.sh` route installs Bun and Rove but not Node.
- With git missing, the new-task dialog reported "this folder isn't a git repository yet" and told the user to run three `git` commands that would also fail. It now reports git as missing, matching the welcome pane.
- Declining the agent skill in the setup wizard no longer re-asks on the next launch.
- The wizard's closing line now names the command you invoked instead of always saying `rove`.
