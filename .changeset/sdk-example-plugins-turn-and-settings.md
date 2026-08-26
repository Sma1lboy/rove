---
"@sma1lboy/rove-plugin-sdk": patch
---

Add two runnable SDK example plugins under `examples/`:
`turn-notify` demonstrates `turn.complete` / `agent.permission-needed` hooks,
reading `detail.turn` usage, and toasting via `notify()`;
`settings-demo` declares string/enum/boolean settings and prints the effective
config from an action entrypoint using `readSettings()` / `setting()`.
Also adds an `examples/README.md` index covering all three examples.
