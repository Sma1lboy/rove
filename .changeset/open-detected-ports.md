---
"@sma1lboy/rove": patch
---

The web Files pane now shows `[ open :PORT ]` for every port where a task's own processes serve a page, so a dev server an agent started opens in the Browser panel with nothing to set up. The `.rove/run.sh` run action (`[ run ]` / `[ stop ]`, with `run.portBase` and `run.portCount`) is removed: start the dev server from the agent or a shell tab instead.
