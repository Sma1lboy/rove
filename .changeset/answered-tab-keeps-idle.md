---
"@sma1lboy/rove": patch
---

Sidebar: answering an engine's question no longer blanks that tab's status glyph.

The optimistic overlay hid the stale `?` by deleting the tab's activity entry, but an
absent entry reads as "the daemon has never reported this tab" and the row fell back to
the dim `·` — for the mark's full 30-minute life, on a session that was visibly working.
The answered tab is now downgraded to `idle` instead, so it rests at `○`.
