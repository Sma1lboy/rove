# Rove plugin SDK examples

Small, runnable plugins that each demonstrate one part of the SDK contract.
Link them with `rove plugin link <dir>` (or `bun plugin-sandbox <name> link
<dir>`) and watch the daemon run their hooks.

- **hello-events** — subscribe to `task.created` and `issue.changed`; append the
  event envelope to a JSONL log.
- **turn-notify** — subscribe to `turn.complete` and `agent.permission-needed`;
  toast a summary via `notify()` and read turn usage from `detail.turn`.
- **settings-demo** — declare string/enum/boolean settings; run an action that
  reads the config `.env` with `readSettings()` / `setting()`.
