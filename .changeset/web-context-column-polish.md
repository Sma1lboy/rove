---
"@sma1lboy/rove": patch
---

The web Context column no longer loses a Claude conversation's breakdown: after a daemon restart or a cleared conversation it asks Claude Code again by itself, where before the parts vanished until you reopened the column. The column also reads better: tokens and percentages sit in aligned columns, a part's files, tools and skills line up under it with a "+N more" row for the rest, a memory file keeps its file name when the path is too long, each part keeps one colour, free space sits apart from what is used, and a line says so while the breakdown is being read.
