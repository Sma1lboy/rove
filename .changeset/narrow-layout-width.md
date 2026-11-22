---
"@sma1lboy/rove": patch
---

The width where the terminal app switches to one panel at a time is now a setting: `layout.narrowBelow` in `state.json` (default `70` columns). Set it higher to get the single-panel layout in a slim tmux split, or `0` to keep all three panes at any width.
