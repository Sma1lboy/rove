---
"@sma1lboy/rove": patch
---

Six changes for watching several sessions at once.

- **The Inbox queues blocked sessions first.** A permission prompt, a rate
  limit, an error, a dead engine, a held or expired prompt and a failing
  routine all sort ahead of plain finished turns; within each group the oldest
  is still first. `F7` therefore lands on the agent that cannot move rather
  than walking four turns that simply ended.
- **Sidebar tab rows say how long.** A row that is working or stopped now
  carries its age (`22m`, `2h`) beside the label. Quiet rows show nothing.
- **`t` cycles a third sort: `attention`.** Blocked tasks first, then ones
  whose turn landed unread, most-recently-touched inside each group. The chord
  now walks default → recent → attention → default.
- **A landed turn flashes on the sidebar row**, not only on the tab strip —
  which is hidden by default, so on a stock install nothing announced it. Both
  surfaces share one pulse duration.
- **A rate limit reads amber on the rail, not red.** It is the one attention
  state that clears itself; the tab strip and the Inbox already drew it amber,
  so the three surfaces now agree. The `!` glyph is unchanged.
- **Right-click a Kanban card to change its status.** The board's only other
  route out of a column was the detail drawer.
