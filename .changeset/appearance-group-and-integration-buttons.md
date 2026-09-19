---
"@sma1lboy/rove": patch
---

Settings groups everything that changes how Rove looks, and engine integrations can be removed as well as installed. Theme, transparency, focus accent, split style and rail fold were scattered through General as five unrelated toggles; they are now one Appearance group with a sample above it that redraws as you pick, so "what does this one do" no longer means closing Settings to look at the rail. Cursor order follows the new layout, so walking the group with j/k stays inside it.

The Engines section's install action gains a Remove beside it — two buttons on one row, enter fires whichever the cursor is on, no chord to learn. An engine whose CLI is not on this machine now reads "engine not installed" in muted text instead of wearing the same warning as an install that genuinely failed, which used to make the section look broken on every machine that had not installed all six engines.
