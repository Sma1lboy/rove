---
"@sma1lboy/rove": patch
---

`rove api spawn` is gone: `add` is the one verb that creates a task. Called from a verified rove session it now nests the new task under the caller's top-level task (same repo only; another repo, a routine session, `--machine` or an unverifiable env stays top level) and cuts the worktree from the caller's current branch tip, with `--count` siblings all parented. `--parent ID` picks another parent, `--no-parent` opts out, `--no-worktree` shares the parent's directory, and `--isolate-in LINK` cuts the worktree in a linked repo. The agent skill is v93.
