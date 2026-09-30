# Rove plugin SDK examples

Small, runnable plugins that demonstrate the surfaces in `docs/PLUGIN-AUTHORING.md`.

| Example | Surfaces | What it shows |
|---|---|---|
| `hello-events/` | `[[events]]` | Log every `task.created` / `issue.changed` to a JSONL file. |
| `turn-notify/` | `[[events]]` | Toast a summary on `turn.complete` / `agent.permission-needed` via `notify()`; read turn usage from `detail.turn`. |
| `settings-demo/` | `[[settings]]`, `[[actions]]` | Declare string/enum/boolean settings; an action reads the config `.env` with `readSettings()` / `setting()`. |
| `task-board/` | `[[panes]]`, `[[actions]]` | Live task board drawn from `task.snapshot` + `engine-state`; headless `snapshot` action prints one frame. |
| `row-tokens/` | `[[actions]]`, `[[events]]` | Claim a task and paint the claim on its row with `setRowToken()`; the label fades when the plugin stops refreshing it. |
| `contrib-engine/` | `[[engines]]` | Manifest-only fake engine with identity and screen-state rules. |

Link any example into a named dev sandbox to try it:

```bash
cd packages/kobe
bun dev:sandbox --name demo run plugin link ../kobe-plugin-sdk/examples/task-board
bun dev:sandbox --name demo run plugin action invoke examples.task-board.snapshot
```

## Demo clips

Each example is recorded in the real TUI — where the surface it declares
actually appears — as a film in `packages/kobe-harness/e2e/films/`; the clips
are embedded in [`docs/PLUGIN-AUTHORING.md`](../../../docs/PLUGIN-AUTHORING.md).
A take records the PTY once (`<name>.cast.gz`, committed) and `render` turns
it into the GIF, so re-encoding never needs the stack. Each take removes the
task or story it filed, but a fresh fixture is still the safest start. Every
example must be linked BEFORE the harness boots: the TUI reads the plugin
registry once at start.

```bash
cd packages/kobe-harness
bun e2e/hero-fixture.ts --fresh && bun e2e/hero-plugins.ts
bun e2e/hero-serve.ts             # keep running
bun e2e/film.ts take task-board   # also contrib-engine, settings-demo, hello-events, turn-notify
bun e2e/film.ts render task-board # re-encode only; no stack needed
```
