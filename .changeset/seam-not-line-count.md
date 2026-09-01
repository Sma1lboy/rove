---
"@sma1lboy/rove": patch
---

Module comments now name the seam a split found, not the line count that
prompted it. 96 comments across 80 files said a module existed "for the
file-size cap"; each was rewritten to state what the two halves each own —
pure decision vs. side-effecting execution, local cache vs. network, data vs.
behavior — or, where the split really was mechanical (the keybinding tables,
the RPC handler registry grouped by wire-name prefix), to say so plainly
rather than invent a boundary. Comments only; no code changed.
