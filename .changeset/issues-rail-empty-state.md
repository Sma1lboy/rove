---
"@sma1lboy/rove": patch
---

Align GitHub Issues docs with the TUI and improve the page's empty state

The GitHub Issues page is wired behind `ctrl+a 3` but intentionally has no
sidebar rail row until it earns one through a design pass. The user-facing
docs previously advertised `ctrl+a 3` as a formal shortcut; they now describe
`rove api workitem-*` as the only supported entry point. When the current repo
has no GitHub remote (or `gh` is missing / not authenticated), the page now
shows an actionable hint and a `q` / `esc` close reminder instead of a bare
error line.
