---
"@sma1lboy/rove": patch
---

A task on an experimental remote (`ssh://`) project now refuses the engine launch instead of spawning locally

`rove add --remote` and the Settings toggle both say hosted PTY engine launch over SSH is not implemented, but nothing enforced it: a remote task's worktree lives on the other machine, so opening its tab or sending it a prompt started an engine here against a directory that does not exist, and surfaced as a bare "failed to start hosted engine session". One guard at the launch builder — the single spawn-spec path the Workspace host, `rove api send`, and a prompted `add` all funnel through — now returns `hosted engine launch over SSH is not implemented`, naming the project.
