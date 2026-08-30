---
"@sma1lboy/rove": patch
---

Three dead UI wires now actually do something

- Files pane `a` pastes an `@path` mention into the active engine's composer
  (without submitting) so you can reference the file under the cursor while
  composing. The keybinding row existed — and showed in F1 — but no host
  wired the action, so the key did nothing.
- The sidebar tree's right-click menu no longer offers Pin on a project main
  row (`setPinned` silently no-ops there — a main checkout is always pinned),
  and the branch-picker no longer opens for a directory task, whose branch
  `setBranch` refuses to set.
- The Settings notifications hint no longer promises a "tab-chip unread dot"
  that no UI renders — tab chips derive from the persisted seen-tabs
  timestamps instead.
