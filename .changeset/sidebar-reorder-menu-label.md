---
"@sma1lboy/rove": patch
---

Rename the sidebar tree menu's misleading "Merge into local" entry to "Reorder row"

The right-click menu on worktree and tab rows offered a "Merge into local" / "合入本地分支" item that actually toggled reorder mode. The label, action id (`localMerge` → `reorder`), and i18n keys are now aligned with the existing Shift+M keybinding and the move/reorder behavior they invoke. A real land entry is intentionally not added here; that product decision belongs to issue #66.
