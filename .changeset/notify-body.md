---
"@sma1lboy/rove": patch
---

`rove api notify` takes `--body`, so the SDK's `notify(title, body)` works.
The SDK has shipped that two-argument signature since it existed — the README
example, the PLUGIN-SDK reference and the `turn-notify` example plugin all use
it — but the verb had no such flag, so every hook that called it exited 1 with
`unknown flag --body`. The body now rides the `notice.event` channel into the
toast's second line, a slot the TUI already rendered for engine-side
notifications.
