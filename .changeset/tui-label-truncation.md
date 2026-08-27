---
"@sma1lboy/rove": patch
---

Clipped labels across the TUI now end in a visible `…` instead of a bare hard cut: sidebar tree rows (worktree branches and tab titles) truncate to the rail's live cell budget while the right-edge cluster (pin / PR chip / ±stats) keeps its cells, and toast titles/bodies truncate to the card. The files-pane header chips no longer lose their inner gap on a narrow pane ("[~]Zen") — they wrap whole instead — and the toast stack clamps to the terminal width rather than poking across the neighbouring pane.
