---
"@sma1lboy/rove": patch
---

`max` is now listed everywhere the other five Codex effort levels are. The engine declares `none`/`low`/`medium`/`high`/`xhigh`/`max` and accepted all six at runtime, but `rove api schema`'s `set-effort` summary and `--level` description both stopped at `xhigh` — so an agent reading the schema to decide what to pass could never discover `max`. ENGINES.md and API.md carried the same short list.
