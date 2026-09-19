---
"@sma1lboy/rove": patch
---

The New task dialog stops asking about depth, model and reasoning level. Those three rows made creating a task a six-field form, and two of them were answering a question the dialog is the wrong place for: depth and effort belong to auto-effort, which owns that decision in Settings, and a pinned model is a per-task exception rather than something every new task should be prompted for. Both remain settable after the fact — `rove api set-model` / `set-effort`, or the change-engine picker. Creating a task now asks what creating a task needs: where, with which engine, opening what. Removing the rows also removed them as Tab stops, which matters more than the visual change: focus parked on an unrendered field swallows every keystroke after it.
