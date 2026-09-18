---
"@sma1lboy/rove": patch
---

A task can now pin a **model**, the way it pins a reasoning effort: `rove api add --model`, `rove api set-model`, and a model row in both the new-task dialog and the change-engine picker (free text with the engine's own list as suggestions — `pi --list-models`, `omp models --json`, a short alias list for claude and codex). The value goes to the engine verbatim in its spelling; an engine with no model flag refuses one (`BAD_MODEL`) instead of dropping it at launch. `engine-list` prints each engine's `models`. The new-task dialog also gains the effort row it lacked.

On top of that, **auto effort**: a new task can be started at a depth — `swift`, `standard`, `deep` — and Rove fills engine, model and effort from the table in Settings → Auto effort (`autoEffort.<tier>.*` in `state.json`, editable with the same picker a task uses). The three fields stay visible and editable; the tier is recorded on the task (`.task.tier`). `rove api add --tier` does the same from a shell and refuses a tier whose target cannot start (`TIER_UNAVAILABLE`) or an explicit engine flag beside it (`CONFLICTING_FLAGS`).
