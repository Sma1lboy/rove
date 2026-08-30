---
"@sma1lboy/rove": patch
---

Performance fixes for large installs (hundreds of tasks)

Six hot paths that were tuned for ~20 tasks and turned into the main cost at
real-install scale:

- `state.json` and `tasks.json` are now written compact. Both files are
  rewritten whole on every change and read only by machines; the
  pretty-print indentation tripled their bytes for no reader.
- The attention Inbox now caps at 500 pending episodes, pruning the oldest
  (same shape as the other daemon stores). An episode only left on
  visit / dismiss / a new turn / task deletion, so a task you never reopened
  kept its episode forever — and every episode rewrote the whole file.
- Cross-task notification toasts no longer re-scan the whole task list per
  notification; one index build per pass instead.
- The sidebar tree's orphan-tab backstop no longer re-scans the task list
  per orphan row.
- Sidebar TAB rows memoize their row view on the real inputs, so the ~10Hz
  spinner tick stops re-deriving every idle tab row (the flat cards already
  did this).
- Orphaned `terminalTabs.*` snapshots are swept on every task-list change,
  not once per launch — a task deleted by another client (`rove api`, web
  board) used to leave its snapshot taxing every kv write until restart.
  The empty-list guard that protects a pre-connection render from wiping
  live snapshots is unchanged.
