---
"@sma1lboy/rove": patch
---

Fix four layout defects found in a width audit. The workspace footer no longer overflows narrow terminals: the quota chip cluster now yields to the key-hint bar (shrink + clip + budget-truncated chips, degrading to compact vendor+percent form) instead of colliding at 80 columns. Section-header divider rules repeat to the terminal width instead of a hardcoded 240 cells, so the rule stops running dry past 240 columns. The sidebar rail grows with the terminal (a sixth of the width, clamped to [24, 40]) so branch names stop truncating on wide terminals. Column math in the prefix HUD and welcome pane measures display cells instead of String.length, so CJK labels and chord glyphs align in the zh-default locale.
