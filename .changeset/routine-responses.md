---
"@sma1lboy/rove": patch
---

Routine runs now carry a response. Every routine prompt Rove delivers starts with a `[ROVE ROUTINE]` line naming its run, and the agent answers that run with `rove api routine-respond --run <id> (--text T | --prompt-file PATH|-)` (one response per run, 32,000-character cap). The Routines page splits the selected routine into run history and its responses, rendered as markdown; a delivered run with no answer shows "awaiting response", then "no response" after two hours, and a new response lands in the Inbox.
