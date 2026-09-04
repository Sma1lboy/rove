---
"@sma1lboy/rove": patch
---

Fix contrib and plugin engines reading as "no engine is running". The
process-tree walk that answers "which engine is live in this tab" only ever
asked about the four built-ins, so a working Gemini CLI, OpenCode, Cursor
Agent, Grok, Droid, Amp, or plugin engine got the *confirmed-absent* answer
rather than an unrecognised one. Five surfaces acted on it: the daemon wrote a
positive `rest` observation over a working engine every walk tick (and never
recorded its death), the TUI attached no turn detector so the contrib screen
manifests were never evaluated, a live engine tab was relabelled `shell N` with
its title discarded, and `rove api get-task`'s `.tabs[].liveVendor` reported
`null`. The walk now asks about every engine id the registry can name without
reading state.
