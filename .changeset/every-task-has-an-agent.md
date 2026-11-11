---
"@sma1lboy/rove": patch
---

A task always has an agent. `rove api add` with nothing to run (no `--prompt`, `--prompt-file`, `--start`, `--count`, `--agents` or `--worktree-only`) is refused with `EMPTY_SESSION` for every caller, not only from inside a session: say `--prompt` for work, `--start` for an idle engine you will type into, or `--worktree-only` for a checkout. A `--worktree-only` checkout is never a sidebar or web rail row, nested or top level, until an engine starts a turn in it; `rove api list` and the Worktrees page still show it. In the web New session composer, **Create without starting** is gone, and **Later** writes its schedule with the task in one call so the row is never left with neither an agent nor a due start. The Android and iOS create sheets need a first prompt.
