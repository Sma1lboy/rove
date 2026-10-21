---
"@sma1lboy/rove": patch
---

Several TUIs attached to one daemon now keep a task's tabs in step. A tab one TUI opens shows up in the others right away, a tab one TUI closes disappears from the others instead of lingering, and switching to a stale row can no longer bring a closed tab back with a fresh engine. Two TUIs opening tabs one after another no longer mint the same tab id.
