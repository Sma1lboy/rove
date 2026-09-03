---
"@sma1lboy/rove": patch
---

`rove api`: `--flag false` now works, `--prompt-file -` no longer reads stdin twice, and a bad `add` leaves no task behind

Four fixes in the `api` flag layer:

- A declared bool flag takes the space form (`--pinned false`, `--remove-worktree false`). The parser turned every bool flag into a presence flag before looking at the next argument, so `--pinned=false` was the only way to say `false` and `--pinned false` died as `unexpected positional arg`. `--force` on its own still means `true`.
- `--prompt-file -` reads stdin once. `routine-update` guards the flag and then reads it, which drained the pipe on the guard and hit EOF on the read — every `--prompt-file -` update failed with `--prompt-file - is empty`.
- `routine-update --persistent-session false` turns a standing routine back into fresh-worktree-per-run. The explicit `false` was dropped from the patch, so the routine stayed standing with no CLI path back.
- `add` validates `--prompt` / `--prompt-file` before it creates the task, instead of after. Passing both (or naming a missing file) created the task, then failed with an error that carried no `taskId` to find it with.
