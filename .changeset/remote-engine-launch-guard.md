---
"@sma1lboy/rove": patch
---

A task on an experimental remote (`ssh://`) project now refuses the engine launch instead of spawning locally

`rove add --remote` and the Settings toggle both say hosted PTY engine launch over SSH is not implemented, but nothing enforced it: a remote task's worktree lives on the other machine, so opening its tab or sending it a prompt started an engine here against a directory that does not exist, and surfaced as a bare "failed to start hosted engine session". One guard at the launch builder — the single spawn-spec path the Workspace host, `rove api send`, and a prompted `add` all funnel through — now returns `hosted engine launch over SSH is not implemented`, naming the project.

In the TUI the workspace pane says it outright rather than mounting an engine tab: opening a remote task used to mint a `claude 1` tab and leave a blank pane while the PTY host retried a local spawn into a directory that is not there.
