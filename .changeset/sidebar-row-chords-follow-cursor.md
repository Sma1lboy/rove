---
"@sma1lboy/rove": patch
---

Sidebar `b` (rename branch), `v` (change engine) and `o` (open in editor) now act on the row under the cursor, like `d`/`r`/`shift+p` already did. Before, they acted on the active task even after `j`/`k` had moved the highlight elsewhere, so a rename or engine change could silently land on a different worktree than the one highlighted. The global `ctrl+a o` still opens the active task unless the sidebar has focus, where it follows the cursor too.
