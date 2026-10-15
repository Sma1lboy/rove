---
"@sma1lboy/rove": patch
---

An owner can now require a report from an unattended agent and see when it never came. `rove api send --expect-report` (or `add --require-report` / `update --require-report on|off`, which arm every `send` to that task) appends a `report --delivery d-N` line to the prompt; the agent closes the turn with the new `rove api report --delivery ID --outcome done|partial|blocked|failed --summary … [--evidence …] [--next …]`, and `rove api deliveries --task-id ID` lists the recent reports newest first.
A turn that completes or fails with no report, an engine that dies, or a tab that stalls for 10 minutes marks the delivery missing and raises a **report missing** Inbox row (TUI, bridge, Android, iOS); a late report or dismissing the row clears it. Routine runs are always armed: `routine-runs` gains `deliveryId` and `deliveryStatus`, and `routine-respond` keeps working as `report --outcome done` on the run's delivery.
The canonical verb order in `rove api schema` gains `deliveries` and `report`, and the bundled agent skill teaches both.
