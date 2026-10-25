---
"@sma1lboy/rove": patch
---

Opening a task in the web UI or on the phone now brings back a tab whose session died, the way the TUI does: an engine tab resumes its conversation and a shell tab gets its shell back. Before, the page showed "this tab has no running session" and gave you no way to get it back. The same revive is available as `rove api tab-revive --task-id <id> --tab <tab>`.
