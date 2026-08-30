---
"@sma1lboy/rove": patch
---

Fix a render-track flake that red-lit unrelated PRs (issue #82)

The prefix-tap shortcut tests polled for the command guide with a hardcoded
1s deadline. The guide is a deliberate delayed reveal — `PrefixHud` opens it
`PREFIX_GUIDE_DELAY_MS` after the tap — and on a loaded CI runner the 1s
window expired before the delayed frame rendered, failing PRs that touched no
TUI code. The wait budget is now anchored to `PREFIX_GUIDE_DELAY_MS` with
room for slow-runner frame latency, the poll helper is shared from the render
harness, and a timeout now names the missing text instead of failing an
unrelated `toContain`.
