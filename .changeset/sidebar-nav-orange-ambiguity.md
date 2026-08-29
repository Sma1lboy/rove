---
"@sma1lboy/rove": patch
---

Mute the sidebar rail's active-page indicator so it no longer competes with pane-focus and card-selection oranges.

- Removed the `theme.focusAccent` background fill from `SidebarNavRail` active items (`src/tui-react/panes/sidebar/chrome.tsx`).
- Active destination now reads as bold normal text (`theme.text`) against the panel background; inactive destinations stay muted.
- Updated the inline contrast comment to explain why the accent fill was intentionally dropped.
