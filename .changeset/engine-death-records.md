---
"@sma1lboy/rove": patch
---

Record engine deaths that happen inside a living terminal. A tab's shell wrapper reaps its engine and drops you at a fallback shell, so the session stays alive and the existing death records — which only fire when the PTY itself exits — never saw it. Seven engines killed by a provider usage limit left zero records.

The activity observer's foreground walk already notices the engine disappear; it now persists that moment to `pty-exits.json` as a `layer: "engine"` record with the engine's pid, its exit code scraped from the wrapper's `Engine exited (code N)` banner, and the terminal tail that holds the provider's error. `rove api inspect` reports both layers, newest first. Every signal Rove sends a terminal subtree is logged to `daemon.log`, so a post-mortem can tell "Rove killed it" from "something else did".
