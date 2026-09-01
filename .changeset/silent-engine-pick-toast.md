---
"@sma1lboy/rove": patch
---

Stop the ctrl+e engine picker toasting "applies on reopen" over the tab it just opened.

Picking an engine from the new-conversation dialog opens a tab already running that engine, but it raised the same toast as the `v` row chord — which switches a task's engine for its *next* enter. On the picker's path that line was noise and, worse, untrue about what was on screen. The `v` chord keeps its toast: there, nothing visible changes until the task is reopened.

Failures still toast on both paths — a rejected write leaves a tab labelled with an engine the task does not have.
