---
"@sma1lboy/rove": patch
---

In the web page, the side panel now holds several tabs and can split top and bottom. Along its top, a quiet row of small tabs (Files, one Diff per file, one Browser per page) with a × on hover, middle-click to close and a `+` for a new Files, a whole-worktree diff or a Browser. Opening a file from Files opens or focuses that file's own Diff tab. Right-click a tab to Split down or move it between the two groups, or drag it; drag the divider to resize, and closing a group's last tab collapses the split. Each Browser tab keeps its own back and forward, `rove api panel-show` focuses or opens the matching tab, and each task's tabs and split are remembered (the old last-view and last-address memory carries over).
