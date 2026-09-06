---
"@sma1lboy/rove": patch
---

A dead engine's `exit.tail` no longer ships raw terminal control bytes to API consumers. `terminalRows` — the one stripper behind `get-task`/`collect`/`inspect` and `read-output` — covered CSI and OSC escapes but not bare C0 (a shell's BEL, a spinner's backspace) or the `ESC ( B` charset select every full redraw emits, so all three reached `pty-exits.json` and every reader of it verbatim. Records already on disk are stripped on read, not just on write.

`.running` and `send` now share one judgement about which tabs hold an engine. `.running` read the persisted `kind` label alone, so a live session the tab snapshot had lost — the `unregistered` rows `get-task` already renders — made a task report `running: false` while `send` delivered into it happily.

Internal: the daemon stops guessing at values kobe owns. `runAutoTitlePass` / `trackedWorktrees` take the default vendor as a required argument instead of a dead `"claude"` literal that would not have followed `DEFAULT_TASK_VENDOR`, and the `ui-prefs` channel reports `theme: null` when `state.json` names no selection rather than naming a theme the daemon has no registry to validate. A duplicated UTF-8 chunk decoder in `pr-status-collector.ts` now calls its same-package twin, and the event-channel payload types moved out of the channel registry into `channels-events.ts`.
