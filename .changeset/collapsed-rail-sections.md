---
"@sma1lboy/rove": patch
---

The collapsed task rail keeps its project sections and says where you are. Folded, the rail was one undifferentiated column of jump digits: the project boundaries the expanded tree draws were gone, so nothing said which repo a row belonged to. It now draws a divider wherever the section changes, grouped by the same key the expanded tree uses (scratch tasks share one bench, exactly as they do unfolded), which costs one cell per boundary instead of a header per section. Selection also carries the same `▌` marker every other row surface uses, resolved through the same function — a background tint was the whole signal before, and under a transparent theme there is no background at all, which is precisely when you need to see where the cursor is. The marker spends a cell the fold already had, so no style got wider.
