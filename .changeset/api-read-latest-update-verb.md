---
"@sma1lboy/rove": patch
---

`rove api read-output` now opens on the newest output: the last 40 messages, or the last 40 terminal lines (`--limit` sets either; terminal goes up to 200). Its `cursor` is a poll point that returns only what the session wrote since, `olderCursor` pages back, and `--tab tab-N` reads that tab's own conversation. Together with `watch`, this lets a script follow a running session without attaching to it.

Task edits are one verb now: `rove api update` takes any mix of `--title`, `--branch`, `--command`, `--model`, `--effort`, `--pinned`, `--status` and `--report-*`, and `--tab tab-N --title` renames a tab. Breaking: `rename`, `set-branch`, `set-command`, `set-effort` (whose `--level` is now `--effort`), `set-model`, `set-status` and `pin` are removed. `issue-set-status` moved to `issue-update --status`, and `routine-set-enabled` to `routine-update --enabled`. Calling an old verb returns `UNKNOWN_VERB` with its replacement. Run `rove skill install` again to pick up skill version 55.
