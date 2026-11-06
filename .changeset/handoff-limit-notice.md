---
"@sma1lboy/rove": patch
---

A tab that hits a usage limit now shows a one-line strip in the terminal pane (web and TUI) offering Continue in another engine, and continuing from a tab whose engine died replaces that tab in place instead of opening a child task (`rove api send --tab new --handoff-from tab-N --replace`). A live source still opens a child task.
