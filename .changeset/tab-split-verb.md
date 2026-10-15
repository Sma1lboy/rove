---
"@sma1lboy/rove": patch
---

`rove api tab-split --task-id ID --tab TAB --action open|close|rename|reset` edits a Terminal Tab's split panes without a TUI: the TUI's ctrl+\ / ctrl+= / ctrl+w / F2 / F5. Every pane beyond the first is its own hosted login shell, so no command line is taken. `get-task` now lists a tab's `split` layout, and an attached TUI absorbs the edit over the `tab.add` channel. The bridge gains a `tab.split` op and `term.attach` takes an optional `leafId`, which is what `rove --web` splits run on.
