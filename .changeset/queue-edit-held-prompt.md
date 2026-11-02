---
"@sma1lboy/rove": patch
---

`rove api queue-edit --id q-N --prompt TEXT` rewrites a prompt `send --queue` is holding for a busy tab, keeping its place in line, so a typo or a changed plan no longer means cancelling and re-queuing at the back. It answers `pasting` instead of claiming success when the prompt's turn already came. The agent skill is v97.
