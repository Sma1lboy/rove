---
"@sma1lboy/rove": patch
---

A terminal read no longer comes back blank when the engine's screen ends in empty rows. The Inbox's reply preview showed "no output yet" for a Claude session with text on screen, and `rove api read-output --source terminal --limit 12` returned twelve empty lines; blank rows below the last text now don't count toward the limit.
