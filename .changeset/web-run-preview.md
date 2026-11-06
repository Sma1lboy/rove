---
"@sma1lboy/rove": patch
---

A repo can ship `.rove/run.sh`. In a task of that repo the web Files pane offers `[ run ]`, which starts it in a shell tab of the task with `$PORT` set to a port no other task holds (kept per task; range `run.portBase` / `run.portCount`), `[ stop ]`, and, once the port listens, `[ open :PORT ]` to show it in the Browser panel. `rove api tab-new --kind shell` gains `--type TEXT` to type a command into the new shell.
