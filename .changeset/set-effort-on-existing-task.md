---
"@sma1lboy/rove": patch
---

Reasoning effort is now settable on a task that already exists. The sidebar row menu's "Change engine" dialog gained a second row listing the engine's declared levels (codex's `none`/`low`/`medium`/`high`/`xhigh`), picked with `←→`; engines that declare no levels show no row. The new `rove api set-effort --task-id ID --level LEVEL` does the same from a shell, and rejects a level the task's engine does not declare instead of passing it through to a launch that would silently drop it.
