---
"@sma1lboy/rove": patch
---

Add GitHub Issues to the sidebar navigation rail.

- `SIDEBAR_NAV_ITEMS` now includes `{ nav: "issues", labelKey: "tasks.nav.issues", bindingId: "workItems.open" }`.
- Removed the stale comment that kept Issues off the rail pending a design pass.
- Updated `docs/KEYBINDINGS.md`, `docs/TUI.md`, and `docs/design/work-items.md` to describe Issues as a first-class rail destination.
- Updated sidebar navigation unit and render tests to expect the new row and cycling order.
