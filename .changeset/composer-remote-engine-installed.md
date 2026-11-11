---
"@sma1lboy/rove": patch
---

The web New task composer now shows which engines are not installed on the machine you picked, and no longer starts a task there on one: before, the task was created and its engine exited at once with "command not found". `rove api engine-list --status` reports `installed` and `ready` per engine, and with `--machine` answers for that machine.
