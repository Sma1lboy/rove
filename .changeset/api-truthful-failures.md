---
"@sma1lboy/rove": patch
---

`rove api` no longer reports a failed engine as a healthy one. `add` returns `.engine` (the vendor, command, model and effort the task actually launches) and warns when `--model` belongs to another vendor (codex handed a `claude-*` id). When an engine with no failure hook, such as codex, dies on screen, `collect` reads `error` with the engine's message instead of `idle`, `read-output` carries it as `engineError`, and `send` into a session already in `error` or `dead` says so with `targetState`. `collect`'s schema entry lists every `.activity.state` value and what it means.
