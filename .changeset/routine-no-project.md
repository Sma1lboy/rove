---
"@sma1lboy/rove": patch
---

Routines no longer need a repo. `rove api routine-create --no-repo` schedules a prompt that belongs to no project: each run works in its own directory under `~/.rove/routines/` as a plain directory session (no worktree or branch), and those sessions sit in a new "No project" sidebar group next to your Scratch shells. The Routines composer offers "No project" in its repo picker. Pass exactly one of `--repo` and `--no-repo`; a forgotten `--repo` is still an error.
