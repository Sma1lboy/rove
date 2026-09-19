---
"@sma1lboy/rove": patch
---

The sidebar's second tab-row line names the engine that is actually running, probed from the pty child's process tree, instead of reading a config field. It shipped reading `task.model` / `task.modelEffort` and falling back to the words "engine default" — which is what nearly every task has, so the rail filled with a phrase that carried no information. A process name is an observation and is there for every live agent tab; a pinned model is configuration and usually absent. A tab with nothing to report now renders no second line at all rather than spending a cell to say "unknown", and the caption sits flush with the tab title instead of indented under it.
