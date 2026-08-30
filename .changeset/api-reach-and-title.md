---
"@sma1lboy/rove": patch
---

Broadcast verbs report reach, pane-open returns its title, list exposes the active task

`pane-open`, `pane-close`, and `notify` are broadcast-only: an attached TUI performs the split/close/toast, so headless they did nothing while still returning `ok: true` — and an agent had no way to know. Their results now carry `clients`, the same attached-connection reach signal `dispatch` already reports (`0` = nobody performed it; the calling CLI counts itself, so `1` is not proof a UI listened).

`pane-open` also returns the resolved `title` — the label `pane-close --title` must match. Previously the title was silently derived (the command's first word) and never surfaced, so closing a pane opened without `--title` was guesswork, and a `pane-close` that matched nothing was invisible.

`list` now returns `activeTaskId`, the shared focus that `send` / `pane-open` / `pane-close` / `read-output` default to when `--task-id` is omitted. A delivery that rode the implicit target can now be audited after the fact.
