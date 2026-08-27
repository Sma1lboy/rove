---
"@sma1lboy/rove": patch
---

Fix five small bugs that tests had pinned in place: markdown link URLs now keep
one level of balanced parens (`http://a.com/foo(bar)` links whole instead of
truncating into a dead href), non-asset image syntax falls back to a safe link
without leaving a stray `!` artifact, `parseDiffRows("")` returns an empty
array instead of a phantom blank meta row, the doctor report's pty section
header now names the real `pty.log` file (and both log headers share the tail
count with the tail call), and `rove export --json` serializes `archived` as a
real boolean so `jq 'select(.archived)'` works. Scheme allowlists, escaping,
and the issue-asset image gate are unchanged and re-verified against XSS
payloads.
