---
"@sma1lboy/rove": patch
---

A task can span several repos: `rove api add --repo A --repo B` (first = primary, up to 8) cuts one worktree per repo on a shared branch, all or nothing. The engine runs in the primary and is told about the others (`--add-dir` for engines that support it, `ROVE_TASK_REPOS` / `ROVE_REPO_<NAME>`, one note on the first message). Delete checks every repo for uncommitted work first and removes them together. `land` probes every repo, merges in picked order and stops at the first conflict with `.repos[]` showing what landed; running it again resumes, and worktrees go only after the last repo lands. `land` and the new `sync` verb take `--repo NAME`; sync merges each repo's own base. Each repo's PR is polled separately and the chip, `context` and `collect` show the worst status. A build from before this one drops the extra repos from the task index on its next write, which orphans their worktrees (clear them with `git worktree remove`).
